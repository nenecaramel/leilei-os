import SwiftUI

struct GlobalSearchFiltersMenu: View {
    @Binding var modules: Set<GlobalSearchModule>
    @Binding var timePreset: GlobalSearchTimePreset
    @Binding var scope: GlobalSearchScope

    var body: some View {
        Menu {
            Menu("Modules") {
                ForEach(GlobalSearchModule.allCases) { module in
                    Button {
                        if modules.contains(module) {
                            modules.remove(module)
                        } else {
                            modules.insert(module)
                        }
                    } label: {
                        Label(module.title, systemImage: modules.contains(module) ? "checkmark" : "")
                    }
                    .menuActionDismissBehavior(.disabled)
                }
            }

            Menu("Time") {
                ForEach(GlobalSearchTimePreset.allCases) { preset in
                    Button {
                        timePreset = preset
                    } label: {
                        Label(preset.title, systemImage: timePreset == preset ? "checkmark" : "")
                    }
                    .menuActionDismissBehavior(.disabled)
                }
            }

            Menu("Scope") {
                ForEach([GlobalSearchScope.all, .active, .archived]) { option in
                    Button {
                        scope = option
                    } label: {
                        Label(option.title, systemImage: scope == option ? "checkmark" : "")
                    }
                    .menuActionDismissBehavior(.disabled)
                }
            }

            Divider()

            Button("Clear Filters", action: clearFilters)
                .disabled(filtersAreDefault)
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .medium))
        }
        .accessibilityLabel("Search filters")
    }

    private var filtersAreDefault: Bool {
        modules == GlobalSearchModule.defaultModules
            && timePreset == .anyTime
            && scope == .active
    }

    private func clearFilters() {
        modules = GlobalSearchModule.defaultModules
        timePreset = .anyTime
        scope = .active
    }
}
