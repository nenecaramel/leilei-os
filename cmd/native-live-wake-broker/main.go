package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultPort    = "3000"
	defaultWait    = 25 * time.Second
	maxWait        = 30 * time.Second
	maxRequestBody = 8 << 10
)

type broker struct {
	mu               sync.Mutex
	generation       string
	version          uint64
	changed          chan struct{}
	lastListenerSeen time.Time
}

type cursor struct {
	generation string
	version    uint64
}

func newBroker() (*broker, error) {
	generation, err := randomGeneration()
	if err != nil {
		return nil, err
	}
	return &broker{
		generation: generation,
		changed:    make(chan struct{}),
	}, nil
}

func (b *broker) snapshot() cursor {
	b.mu.Lock()
	defer b.mu.Unlock()
	return cursor{
		generation: b.generation,
		version:    b.version,
	}
}

func (b *broker) markListenerSeen() {
	b.mu.Lock()
	b.lastListenerSeen = time.Now()
	b.mu.Unlock()
}

func (b *broker) listenerOnline() bool {
	b.mu.Lock()
	lastSeen := b.lastListenerSeen
	b.mu.Unlock()
	return !lastSeen.IsZero() &&
		time.Since(lastSeen) <= 45*time.Second
}

func (b *broker) wake() cursor {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.version++
	close(b.changed)
	b.changed = make(chan struct{})
	return cursor{
		generation: b.generation,
		version:    b.version,
	}
}

func (b *broker) wait(
	generation string,
	afterVersion uint64,
	timeout time.Duration,
	done <-chan struct{},
) (string, cursor) {
	b.mu.Lock()
	if generation != b.generation {
		current := cursor{
			generation: b.generation,
			version:    b.version,
		}
		b.mu.Unlock()
		return "reset", current
	}
	if afterVersion < b.version {
		current := cursor{
			generation: b.generation,
			version:    b.version,
		}
		b.mu.Unlock()
		return "ready", current
	}
	changed := b.changed
	b.mu.Unlock()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	outcome := "timeout"
	select {
	case <-changed:
		outcome = "ready"
	case <-timer.C:
	case <-done:
		outcome = "timeout"
	}

	return outcome, b.snapshot()
}

func main() {
	token := strings.TrimSpace(os.Getenv("WAKE_BROKER_TOKEN"))
	if len(token) < 32 {
		log.Fatal("WAKE_BROKER_TOKEN must contain at least 32 characters")
	}

	instance, err := newBroker()
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(
		response http.ResponseWriter,
		_ *http.Request,
	) {
		writeJSON(response, http.StatusOK, map[string]any{
			"status": "ok",
		})
	})
	mux.Handle(
		"GET /state",
		requireBearer(token, http.HandlerFunc(func(
			response http.ResponseWriter,
			_ *http.Request,
		) {
			instance.markListenerSeen()
			current := instance.snapshot()
			writeCursor(response, http.StatusOK, "", current)
		})),
	)
	mux.Handle(
		"GET /presence",
		requireBearer(token, http.HandlerFunc(func(
			response http.ResponseWriter,
			_ *http.Request,
		) {
			writeJSON(response, http.StatusOK, map[string]any{
				"online": instance.listenerOnline(),
			})
		})),
	)
	mux.Handle(
		"POST /wake",
		requireBearer(token, http.HandlerFunc(func(
			response http.ResponseWriter,
			request *http.Request,
		) {
			_, _ = io.Copy(
				io.Discard,
				io.LimitReader(request.Body, maxRequestBody),
			)
			_ = request.Body.Close()
			current := instance.wake()
			writeCursor(response, http.StatusOK, "", current)
		})),
	)
	mux.Handle(
		"POST /wait",
		requireBearer(token, http.HandlerFunc(func(
			response http.ResponseWriter,
			request *http.Request,
		) {
			request.Body = http.MaxBytesReader(
				response,
				request.Body,
				maxRequestBody,
			)
			defer request.Body.Close()

			var payload map[string]any
			decoder := json.NewDecoder(request.Body)
			if err := decoder.Decode(&payload); err != nil {
				writeJSON(response, http.StatusBadRequest, map[string]any{
					"error": "invalid request",
				})
				return
			}

			instance.markListenerSeen()

			generation, _ := payload["generation"].(string)
			generation = strings.TrimSpace(generation)
			if generation == "" {
				writeJSON(response, http.StatusBadRequest, map[string]any{
					"error": "generation is required",
				})
				return
			}

			afterVersion, ok := readUint(payload["after_version"])
			if !ok {
				writeJSON(response, http.StatusBadRequest, map[string]any{
					"error": "after_version is invalid",
				})
				return
			}

			timeout := defaultWait
			if timeoutMS, ok := readInt64(payload["timeout_ms"]); ok && timeoutMS > 0 {
				timeout = time.Duration(timeoutMS) * time.Millisecond
				if timeout > maxWait {
					timeout = maxWait
				}
			}

			outcome, current := instance.wait(
				generation,
				afterVersion,
				timeout,
				request.Context().Done(),
			)
			writeCursor(response, http.StatusOK, outcome, current)
		})),
	)

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultPort
	}
	if _, err := strconv.Atoi(port); err != nil {
		log.Fatal("PORT must be numeric")
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       70 * time.Second,
	}
	log.Printf("native live wake broker listening on :%s", port)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func requireBearer(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		const prefix = "Bearer "
		auth := request.Header.Get("Authorization")
		if !strings.HasPrefix(auth, prefix) ||
			strings.TrimSpace(strings.TrimPrefix(auth, prefix)) != token {
			writeJSON(response, http.StatusUnauthorized, map[string]any{
				"error": "unauthorized",
			})
			return
		}
		next.ServeHTTP(response, request)
	})
}

func randomGeneration() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func writeCursor(
	response http.ResponseWriter,
	status int,
	outcome string,
	current cursor,
) {
	payload := map[string]any{
		"generation": current.generation,
		"version":    current.version,
	}
	if outcome != "" {
		payload["outcome"] = outcome
	}
	writeJSON(response, status, payload)
}

func writeJSON(
	response http.ResponseWriter,
	status int,
	value any,
) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func readUint(value any) (uint64, bool) {
	number, ok := value.(float64)
	if !ok || number < 0 || number != float64(uint64(number)) {
		return 0, false
	}
	return uint64(number), true
}

func readInt64(value any) (int64, bool) {
	number, ok := value.(float64)
	if !ok || number != float64(int64(number)) {
		return 0, false
	}
	return int64(number), true
}
