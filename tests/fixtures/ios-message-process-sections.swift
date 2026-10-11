import Foundation
@main struct ProcessSectionsCheck {
    static func main() {
        func check(_ active: Bool, _ body: Bool, _ thinking: Bool, _ steps: Int, _ loading: Bool, _ activity: Bool, pending: Bool = false, failed: Bool = false, background: Bool = false) {
            let value = NativeLiveProcessSections(isActive: active, hasBody: body, hasThinking: thinking, stepCount: steps, needsInput: pending, hasFailure: failed, hasBackgroundTask: background)
            precondition(value.showsLoading == loading)
            precondition(value.showsThinking == thinking)
            precondition(value.showsActivity == activity)
        }
        check(true, false, false, 0, true, false)
        check(true, false, true, 0, false, false)
        check(true, false, true, 1, false, true)
        check(false, true, true, 3, false, true)
        check(false, true, true, 0, false, false)
        check(true, true, false, 0, false, false)
        check(false, true, false, 0, false, false)
        check(true, false, false, 1, false, true)
        check(false, true, false, 2, false, true)
        check(true, false, false, 0, false, true, pending: true)
        check(false, false, false, 0, false, true, failed: true)
        check(false, true, false, 0, false, true, background: true)
        check(false, false, false, 0, false, false)
        print("Process sections PASS: 13 content/state cases")
    }
}
