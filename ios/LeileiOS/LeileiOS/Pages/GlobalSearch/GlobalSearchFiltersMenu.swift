import SwiftUI

struct GlobalSearchFiltersMenu: View {
    @Binding var modules: Set<GlobalSearchModule>
    @Binding var timePreset: GlobalSearchTimePreset
    @Binding var scope: GlobalSearchScope
    @Binding var mode: GlobalSearchMode
    @Binding var author: GlobalSearchAuthorFilter

    var body: some View {
        Menu {
            Menu("Modules") {
                ForEach(GlobalSearchModule.allCases) { module in
                    Toggle(
                        module.title,
                        isOn: moduleSelectionBinding(module)
                    )
                    .disabled(
                        modules.count == 1
                            && modules.contains(module)
                    )
                    .menuActionDismissBehavior(.disabled)
                }
            }

            Picker("Time", selection: $timePreset) {
                ForEach(GlobalSearchTimePreset.allCases) { preset in
                    Text(preset.title)
                        .tag(preset)
                }
            }
            .pickerStyle(.menu)
            .menuActionDismissBehavior(.disabled)

            Picker("Scope", selection: $scope) {
                ForEach(GlobalSearchScope.allCases) { option in
                    Text(option.title)
                        .tag(option)
                }
            }
            .pickerStyle(.menu)
            .menuActionDismissBehavior(.disabled)

            Picker("Author", selection: $author) {
                ForEach(GlobalSearchAuthorFilter.allCases) { option in
                    Text(option.title)
                        .tag(option)
                }
            }
            .pickerStyle(.menu)
            .menuActionDismissBehavior(.disabled)

            Picker("Match", selection: $mode) {
                ForEach(GlobalSearchMode.allCases) { option in
                    Text(option.title)
                        .tag(option)
                }
            }
            .pickerStyle(.menu)
            .menuActionDismissBehavior(.disabled)

            Divider()

            Button("Clear Filters", action: clearFilters)
                .disabled(filtersAreDefault)
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .medium))
        }
        .accessibilityLabel("Search filters")
    }

    private func moduleSelectionBinding(
        _ module: GlobalSearchModule
    ) -> Binding<Bool> {
        Binding(
            get: { modules.contains(module) },
            set: { isSelected in
                if isSelected {
                    modules.insert(module)
                } else {
                    modules.remove(module)
                }
            }
        )
    }

    private var filtersAreDefault: Bool {
        modules == GlobalSearchModule.defaultModules
            && timePreset == .anyTime
            && scope == .active
            && mode == .normal
            && author == .all
    }

    private func clearFilters() {
        modules = GlobalSearchModule.defaultModules
        timePreset = .anyTime
        scope = .active
        mode = .normal
        author = .all
    }
}
