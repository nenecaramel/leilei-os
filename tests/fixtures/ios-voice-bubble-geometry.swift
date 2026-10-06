import Foundation
@main struct VoiceGeometryChecks {
 static func main() {
  let counts=[0,1,3,8,15,30,60,240,10000]
  let widths=counts.map { NativeLiveVoiceBubbleGeometry.userWidth(transcript:String(repeating:"字",count:$0)) }
  precondition(widths.first == 68 && widths.last == 125)
  precondition(zip(widths,widths.dropFirst()).allSatisfy{$0 <= $1})
  precondition(widths[1] < widths[2] && widths[2] < widths[3])
  precondition(NativeLiveVoiceBubbleGeometry.userWidth(transcript:" a b\n c ") == NativeLiveVoiceBubbleGeometry.userWidth(transcript:"abc"))
  precondition(NativeLiveVoiceBubbleGeometry.userWidth(transcript:"中 é 👨‍👩‍👦") == widths[2])
  precondition(NativeLiveVoiceBubbleGeometry.userWidth(transcript:" \n ") == 68)
  precondition(NativeLiveVoiceBubbleGeometry.userWidth(transcript:"\u{200B}\u{200E}") == 68)
  let durations=[1.0,3,8,15,30,60,120,10000]
  let audio=durations.map{NativeLiveVoiceBubbleGeometry.audioWidth(duration:$0,sizeBytes:nil)}
  precondition(audio.allSatisfy{$0 >= 150 && $0 <= 250})
  precondition(zip(audio,audio.dropFirst()).allSatisfy{$0 <= $1})
  precondition(audio[0] < audio[1] && audio[1] < audio[2] && audio.last == 250)
  precondition(audio[2]-audio[0] > audio[6]-audio[4])
  let fallback=NativeLiveVoiceBubbleGeometry.audioWidth(duration:0,sizeBytes:nil)
  precondition(fallback > 150 && fallback < 250)
  precondition(NativeLiveVoiceBubbleGeometry.audioWidth(duration:0,sizeBytes:1000) < NativeLiveVoiceBubbleGeometry.audioWidth(duration:0,sizeBytes:1000000))
  precondition(NativeLiveVoiceBubbleGeometry.audioWidth(duration:8,sizeBytes:1) == audio[2])
  precondition(abs(NativeLiveVoiceBubbleGeometry.audioWidth(duration:0,sizeBytes:192000)-audio[2]) < 1)
  for (seconds, bytes) in [(1.0,32044),(8.0,64000),(8.0,128044),(8.0,256044),(30.0,960044)] {
   let proxy=NativeLiveVoiceBubbleGeometry.audioWidth(duration:0,sizeBytes:bytes)
   let known=NativeLiveVoiceBubbleGeometry.audioWidth(duration:seconds,sizeBytes:bytes)
   precondition(abs(proxy-known) < 25, "common encoding proxy must not cause a large geometry jump")
  }
  let seed=NativeLiveVoiceBubbleGeometry.identity(entityID:"entity",sha256:"sha",draftID:"draft",filename:"f")
  precondition(seed == "entity")
  precondition(NativeLiveVoiceBubbleGeometry.identity(entityID:nil,sha256:"sha",draftID:"draft",filename:"f") == "sha")
  precondition(NativeLiveVoiceBubbleGeometry.identity(entityID:nil,sha256:nil,draftID:"draft",filename:"f") == "draft")
  let wave=NativeLiveVoiceBubbleGeometry.waveform(identity:seed,width:200)
  precondition(wave == NativeLiveVoiceBubbleGeometry.waveform(identity:seed,width:200))
  precondition(wave != NativeLiveVoiceBubbleGeometry.waveform(identity:"different",width:200))
  for width in [0.0,150,180,200,250,1000] {
   let bars=NativeLiveVoiceBubbleGeometry.waveform(identity:seed,width:width)
   precondition((12...28).contains(bars.count) && bars.allSatisfy{(6...22).contains($0)})
   for progress in [0.0,0.25,0.5,1] {
    let filled=bars.indices.filter{NativeLiveVoiceBubbleGeometry.isFilled(index:$0,count:bars.count,progress:progress)}.count
    precondition(filled == Int(ceil(progress * Double(bars.count))))
   }
  }
  print("Voice geometry PASS widths=\(widths) audio=\(audio) waveform=\(wave)")
 }
}
