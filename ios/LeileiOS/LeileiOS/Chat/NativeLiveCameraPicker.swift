import SwiftUI
import UIKit

struct NativeLiveCameraPicker:
    UIViewControllerRepresentable {
    let onComplete: (Data?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onComplete: onComplete)
    }

    func makeUIViewController(
        context: Context
    ) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType =
            UIImagePickerController.isSourceTypeAvailable(.camera)
                ? .camera
                : .photoLibrary
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(
        _ uiViewController: UIImagePickerController,
        context: Context
    ) {}

    final class Coordinator:
        NSObject,
        UIImagePickerControllerDelegate,
        UINavigationControllerDelegate {
        let onComplete: (Data?) -> Void

        init(onComplete: @escaping (Data?) -> Void) {
            self.onComplete = onComplete
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info:
                [UIImagePickerController.InfoKey: Any]
        ) {
            let image =
                info[.originalImage] as? UIImage
            onComplete(
                image?.jpegData(
                    compressionQuality: 0.92
                )
            )
        }

        func imagePickerControllerDidCancel(
            _ picker: UIImagePickerController
        ) {
            onComplete(nil)
        }
    }
}
