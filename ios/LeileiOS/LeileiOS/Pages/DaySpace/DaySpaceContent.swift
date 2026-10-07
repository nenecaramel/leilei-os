import SwiftUI

struct DaySpaceContent: View {
    let selectedDate: String?
    let discoveryState: DaySpaceDiscoveryState
    let discoveryIncomplete: Bool
    let todoState: DaySpaceModuleState<DaySpaceTodoDay>
    let diaryState: DaySpaceModuleState<[DaySpaceDiary]>
    let onPrevious: () -> Void
    let onSelectDate: () -> Void
    let onNext: () -> Void
    let onRetryTodo: (String) -> Void
    let onRetryDiary: (String) -> Void
    let onRetryDiscovery: () -> Void
    let onRetryDate: (String) -> Void
    let onSelectPaper: (DaySpacePaperSelection) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                DaySpaceDateNavigationRow(
                    selectedDate: selectedDate,
                    onPrevious: onPrevious,
                    onSelectDate: onSelectDate,
                    onNext: onNext
                )
                .padding(.bottom, 8)

                if discoveryIncomplete, selectedDate != nil {
                    DaySpaceWarning(
                        text: "Unavailable"
                    )
                    .padding(.bottom, 8)
                }

                if let selectedDate,
                   hasPartialFailure,
                   !bothModulesFailed {
                    DaySpacePartialFailure(
                        todoFailed: todoState.isError,
                        diaryFailed: diaryState.isError,
                        onRetryTodo: {
                            onRetryTodo(selectedDate)
                        },
                        onRetryDiary: {
                            onRetryDiary(selectedDate)
                        }
                    )
                    .padding(.bottom, 8)
                }
                content
            }
            .frame(maxWidth: 860)
            .padding(.horizontal, LeileiUI.Gutter.canvas)
            .padding(.top, 8)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var content: some View {
        if discoveryState == .loading, selectedDate == nil {
            DaySpaceReadingState()
        } else if discoveryState == .unavailable {
            AppStateSurface(
                title: "Unavailable",
                actionTitle: "Retry"
            ) {
                onRetryDiscovery()
            }
            .frame(
                maxWidth: .infinity,
                minHeight: daySpaceStateHeight,
                alignment: .center
            )
        } else if let selectedDate {
            let papers = currentPapers

            if bothModulesFailed {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    onRetryDate(selectedDate)
                }
                .frame(
                    maxWidth: .infinity,
                    minHeight: daySpaceStateHeight,
                    alignment: .center
                )
            } else if todoState.isLoading && diaryState.isLoading && papers.isEmpty {
                DaySpaceReadingState()
            } else if completeEmpty {
                AppStateSurface(
                    title: "Nothing here",
                )
                .frame(
                    maxWidth: .infinity,
                    minHeight: daySpaceStateHeight,
                    alignment: .center
                )
            } else if !papers.isEmpty {
                DaySpaceStage(
                    dateKey: selectedDate,
                    papers: papers
                ) { paper in
                    onSelectPaper(paper)
                }
            }
        }
    }

    private var hasPartialFailure: Bool {
        todoState.isError || diaryState.isError
    }

    private var bothModulesFailed: Bool {
        todoState.isErrorWithoutValue && diaryState.isErrorWithoutValue
    }

    private var completeEmpty: Bool {
        guard case .ready(let todo) = todoState,
              case .ready(let diaries) = diaryState
        else {
            return false
        }

        return todo.visiblePapers.isEmpty && diaries.isEmpty
    }

    private var currentPapers: [DaySpacePaperSelection] {
        var result: [DaySpacePaperSelection] = []

        if let todo = todoState.value {
            result.append(contentsOf: todo.visiblePapers.map {
                .todo($0)
            })
        }

        if let diaries = diaryState.value {
            result.append(contentsOf: diaries.map {
                .diary($0)
            })
        }

        return result
    }
}
