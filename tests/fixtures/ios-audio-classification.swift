import Foundation
@main struct AudioClassificationChecks {
 static func main() {
  let cases: [(String,String,String)] = [
   ("audio/mpeg","sound","audio"),("audio/mpeg","misnamed.png","audio"),("audio/wav","misnamed.svg","audio"),("audio/wav","sound","audio"),("audio/mp4","sound.m4a","audio"),
   ("audio/x-custom; charset=binary","sound","audio"),("audio/x~provider","sound","audio"),("application/octet-stream","voice.mp3","audio"),
   ("application/octet-stream","voice.wav","audio"),("application/octet-stream","voice.m4a","audio"),
   ("image/png","x.png","bitmap"),("image/png","misnamed.wav","bitmap"),("image/jpeg","x.jpg","bitmap"),("image/gif","x.gif","bitmap"),("image/webp","x.webp","bitmap"),
   ("image/svg+xml","x.svg","svg"),("application/pdf","x.pdf","file"),("text/plain","x.txt","file"),
   ("application/octet-stream","x.bin","file"),("audio/","x.bin","file"),("audio/not valid","x.bin","file"),
   ("x-audio/mpeg","x.bin","file"),("audio//mpeg","x.bin","file")]
  for (mime,name,want) in cases {
   let input = NativeLiveAttachmentPresentationInput(entityID:"id",draftID:"d",filename:name,mimeType:mime,kind:"file",materialization:"ready")
   precondition(String(describing:input.mediaKind) == want,"\(mime)/\(name): expected \(want), got \(input.mediaKind)")
  }
  print("Audio classification PASS: \(cases.count) cases")
 }
}
