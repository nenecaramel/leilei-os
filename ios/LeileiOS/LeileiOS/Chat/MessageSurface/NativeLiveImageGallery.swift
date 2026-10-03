import SwiftUI
import UIKit

struct NativeLiveImageGallery: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: AppModel
    let selection: NativeLiveGallerySelection
    @State private var index: Int
    init(selection:NativeLiveGallerySelection) { self.selection = selection; _index = State(initialValue:selection.selectedIndex) }
    var body: some View {
        NavigationStack {
            NativeLiveGalleryPager(inputs:selection.inputs,index:$index,appModel:appModel)
                .background(Color(.systemBackground)).ignoresSafeArea(edges:.bottom)
                .navigationTitle("\(index+1) / \(selection.inputs.count)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

private struct NativeLiveGalleryPage: View {
    let input: NativeLiveAttachmentPresentationInput
    let appModel: AppModel
    let zoomChanged: (CGFloat) -> Void
    @StateObject private var loader = NativeLiveMediaLoadState()
    @State private var retry = 0
    @State private var pixels = 2048
    @Environment(\.displayScale) private var displayScale
    var body: some View {
        Group {
            if let image = loader.image {
                NativeLiveZoomImage(image:image,onZoom:zoomChanged)
                    .accessibilityLabel(input.filename)
            } else if let error = loader.error {
                VStack(spacing:16) {
                    Text(input.filename).lineLimit(2).truncationMode(.middle)
                    Text(error).foregroundStyle(.secondary)
                    Button("Retry") { retry += 1 }
                }.padding()
            } else { ProgressView("Loading image…") }
        }
        .onGeometryChange(for:CGSize.self) { $0.size } action: { size in
            if size.width > 0 { pixels = min(3072,max(256,Int(max(size.width,size.height)*displayScale))) }
        }
        .task(id:"\(retry)|\(pixels)") { await loader.load(input,appModel:appModel,pixels:pixels) }
    }
}

// UIKit owns paging and pinch/pan. Paging is disabled while a page is zoomed;
// dismissal is explicit so a dismiss drag never competes with image gestures.
private struct NativeLiveGalleryPager: UIViewControllerRepresentable {
    let inputs: [NativeLiveAttachmentPresentationInput]
    @Binding var index: Int
    let appModel: AppModel
    func makeCoordinator() -> Coordinator { Coordinator(parent:self) }
    func makeUIViewController(context:Context) -> UIPageViewController {
        let controller = UIPageViewController(transitionStyle:.scroll,navigationOrientation:.horizontal)
        context.coordinator.controller = controller
        controller.dataSource = context.coordinator; controller.delegate = context.coordinator
        controller.view.subviews.compactMap { $0 as? UIScrollView }.forEach {
            $0.panGestureRecognizer.maximumNumberOfTouches = 1
        }
        if !inputs.isEmpty { controller.setViewControllers([context.coordinator.page(index)],direction:.forward,animated:false) }
        return controller
    }
    func updateUIViewController(_ controller:UIPageViewController,context:Context) { context.coordinator.parent = self }
    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: NativeLiveGalleryPager
        weak var controller: UIPageViewController?
        private var pages: [Int:UIViewController] = [:]
        init(parent:NativeLiveGalleryPager) { self.parent = parent }
        func page(_ index:Int) -> UIViewController {
            if let existing = pages[index] { return existing }
            let view = NativeLiveGalleryPage(input:parent.inputs[index],appModel:parent.appModel,zoomChanged:{ [weak self] scale in
                self?.controller?.view.subviews.compactMap { $0 as? UIScrollView }.forEach { $0.isScrollEnabled = scale <= 1.01 }
            })
            let hosting = UIHostingController(rootView:view)
            hosting.view.tag = index
            pages[index] = hosting
            return hosting
        }
        func pageViewController(_ pageViewController:UIPageViewController,viewControllerBefore viewController:UIViewController) -> UIViewController? {
            let index = viewController.view.tag - 1
            return index >= 0 ? page(index) : nil
        }
        func pageViewController(_ pageViewController:UIPageViewController,viewControllerAfter viewController:UIViewController) -> UIViewController? {
            let index = viewController.view.tag + 1
            return index < parent.inputs.count ? page(index) : nil
        }
        func pageViewController(_ pageViewController:UIPageViewController,didFinishAnimating finished:Bool,previousViewControllers:[UIViewController],transitionCompleted completed:Bool) {
            guard completed, let current = pageViewController.viewControllers?.first?.view.tag else { return }
            parent.index = current
            pages = pages.filter { abs($0.key-current) <= 1 }
        }
    }
}

private struct NativeLiveZoomImage: UIViewRepresentable {
    let image: UIImage
    let onZoom: (CGFloat) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onZoom:onZoom) }
    func makeUIView(context:Context) -> NativeLiveZoomScrollView {
        let view = NativeLiveZoomScrollView()
        view.delegate = context.coordinator
        view.minimumZoomScale = 1; view.maximumZoomScale = 5
        view.imageView.image = image
        return view
    }
    func updateUIView(_ view:NativeLiveZoomScrollView,context:Context) { view.imageView.image = image; view.setNeedsLayout() }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        let onZoom: (CGFloat) -> Void
        init(onZoom:@escaping (CGFloat)->Void) { self.onZoom = onZoom }
        func viewForZooming(in scrollView:UIScrollView) -> UIView? { (scrollView as? NativeLiveZoomScrollView)?.imageView }
        func scrollViewDidZoom(_ scrollView:UIScrollView) {
            (scrollView as? NativeLiveZoomScrollView)?.centerImage()
            onZoom(scrollView.zoomScale)
        }
    }
}

private final class NativeLiveZoomScrollView: UIScrollView {
    let imageView = UIImageView()
    private var fittedBounds = CGSize.zero
    override init(frame:CGRect) {
        super.init(frame:frame)
        imageView.contentMode = .scaleAspectFit
        addSubview(imageView)
        showsVerticalScrollIndicator = false; showsHorizontalScrollIndicator = false
        bouncesZoom = true
        contentInsetAdjustmentBehavior = .never
    }
    required init?(coder:NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != fittedBounds, bounds.width > 0, bounds.height > 0 else { return }
        fittedBounds = bounds.size
        setZoomScale(1,animated:false)
        let imageSize = imageView.image?.size ?? bounds.size
        let scale = min(bounds.width/max(1,imageSize.width),bounds.height/max(1,imageSize.height))
        let fitted = CGSize(width:imageSize.width*scale,height:imageSize.height*scale)
        imageView.frame = CGRect(origin:.zero,size:fitted)
        contentSize = fitted
        centerImage()
    }
    func centerImage() {
        contentInset = UIEdgeInsets(top:max(0,(bounds.height-contentSize.height)/2),
                                   left:max(0,(bounds.width-contentSize.width)/2),bottom:0,right:0)
    }
}
