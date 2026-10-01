package main

import (
	"testing"
	"time"
)

func TestBrokerWakeAndReset(t *testing.T) {
	instance := &broker{
		generation: "generation-a",
		changed:    make(chan struct{}),
	}

	initial := instance.snapshot()
	if initial.generation != "generation-a" || initial.version != 0 {
		t.Fatalf("unexpected initial cursor: %#v", initial)
	}

	ready := make(chan struct {
		outcome string
		cursor  cursor
	}, 1)
	go func() {
		outcome, current := instance.wait(
			"generation-a",
			0,
			time.Second,
			make(chan struct{}),
		)
		ready <- struct {
			outcome string
			cursor  cursor
		}{outcome: outcome, cursor: current}
	}()

	time.Sleep(10 * time.Millisecond)
	woken := instance.wake()
	if woken.version != 1 {
		t.Fatalf("expected version 1, got %d", woken.version)
	}

	result := <-ready
	if result.outcome != "ready" || result.cursor.version != 1 {
		t.Fatalf("unexpected ready result: %#v", result)
	}

	outcome, current := instance.wait(
		"stale-generation",
		1,
		time.Second,
		make(chan struct{}),
	)
	if outcome != "reset" ||
		current.generation != "generation-a" ||
		current.version != 1 {
		t.Fatalf(
			"unexpected reset result: outcome=%s cursor=%#v",
			outcome,
			current,
		)
	}
}

func TestBrokerTimeoutKeepsCursor(t *testing.T) {
	instance := &broker{
		generation: "generation-a",
		version:    7,
		changed:    make(chan struct{}),
	}

	outcome, current := instance.wait(
		"generation-a",
		7,
		5*time.Millisecond,
		make(chan struct{}),
	)
	if outcome != "timeout" ||
		current.generation != "generation-a" ||
		current.version != 7 {
		t.Fatalf(
			"unexpected timeout result: outcome=%s cursor=%#v",
			outcome,
			current,
		)
	}
}
