import Foundation
@main struct VoiceGeometryChecks {
 static func main() {
  let G=NativeLiveVoiceBubbleGeometry.self
  let cluster=G.userFallbackClusterWidth
  let counts=[0,1,3,8,15,30,60,240,10000]
  let widths=counts.map { G.userWidth(transcript:String(repeating:"字",count:$0),clusterWidth:cluster) }
  precondition(widths.first == cluster && widths.last == 125)
  precondition(zip(widths,widths.dropFirst()).allSatisfy{$0 <= $1})
  precondition(widths[1] < widths[2] && widths[2] < widths[3])
  precondition(G.userWidth(transcript:" a b\n c ",clusterWidth:cluster) == G.userWidth(transcript:"abc",clusterWidth:cluster))
  precondition(G.userWidth(transcript:"中 é 👨‍👩‍👦",clusterWidth:cluster) == widths[2])
  precondition(G.userWidth(transcript:" \n ",clusterWidth:cluster) == cluster)
  precondition(G.userWidth(transcript:"\u{200B}\u{200E}",clusterWidth:cluster) == cluster)
  // Short user voice keeps the right inset but trims leading space; it must remain well below the old 103pt outer width.
  precondition(widths[1] + G.userLeadingInset + G.userTrailingInset < 82)
  precondition(G.contentHeight + 2 * G.verticalInset == 45)
  let minimum=G.audioMinimumWidth()
  precondition(minimum == 116)
  precondition(minimum == 2*G.horizontalInset + G.audioPlayWidth + 2*G.controlGap + G.audioMinimumWaveformWidth + G.audioFallbackLabelWidth)
  let durations=[1.0,3,8,15,30,60,120,10000]
  let audio=durations.map{G.audioWidth(duration:$0,sizeBytes:nil)}
  precondition(audio.allSatisfy{$0 >= minimum && $0 <= G.audioMaximumWidth})
  precondition(zip(audio,audio.dropFirst()).allSatisfy{$0 <= $1})
  precondition(audio[0] < audio[1] && audio[1] < audio[2] && audio.last == G.audioMaximumWidth)
  precondition(audio[1] < audio[2] && audio[2] < audio[4], "3s, 8s, and 30s audio must have distinct widths")
  precondition(audio[0] < 140 && audio[1] < 160, "short audio must reflect the tighter minimum width")
  let fallback=G.audioWidth(duration:0,sizeBytes:nil)
  precondition(fallback > minimum && fallback < G.audioMaximumWidth)
  precondition(G.audioWidth(duration:0,sizeBytes:1000) < G.audioWidth(duration:0,sizeBytes:1000000))
  precondition(G.audioWidth(duration:8,sizeBytes:1) == audio[2])
  precondition(abs(G.audioWidth(duration:0,sizeBytes:192000)-audio[2]) < 1)
  // Historical audio without canonical duration may still use the coarse
  // size/default fallback until first playback. The fallback remains bounded
  // and monotonic, but it is not required to approximate decoded duration.
  let historicalFallbackWidths=[32_044,64_000,128_044,256_044,960_044].map {
   G.audioWidth(duration:0,sizeBytes:$0)
  }
  precondition(historicalFallbackWidths.allSatisfy{$0 >= minimum && $0 <= G.audioMaximumWidth})
  precondition(zip(historicalFallbackWidths,historicalFallbackWidths.dropFirst()).allSatisfy{$0 <= $1})
  for (s,l) in [(0.2,"1\u{2033}"),(1.0,"1\u{2033}"),(4.4,"4\u{2033}"),(7.6,"8\u{2033}"),(23,"23\u{2033}")] {
   precondition(G.durationLabel(seconds:s) == l)
  }
  // Two characters or fewer and two seconds or shorter stay at the shortest width.
  precondition(widths[0] == cluster && widths[1] == cluster)
  precondition(G.userWidth(transcript:"字字",clusterWidth:cluster) == cluster)
  precondition(G.userWidth(transcript:"字字字",clusterWidth:cluster) > cluster)
  precondition(G.audioWidth(duration:1,sizeBytes:nil) == minimum && G.audioWidth(duration:2,sizeBytes:nil) == minimum)
  precondition(G.audioWidth(duration:2.5,sizeBytes:nil) > minimum)
  // The longest bubble follows the width its row offers, not a fixed cap.
  precondition(G.userWidth(transcript:String(repeating:"字",count:240),clusterWidth:cluster,maxContentWidth:263) == 263)
  precondition(G.userWidth(transcript:"字",clusterWidth:cluster,maxContentWidth:263) == cluster)
  precondition(G.audioWidth(duration:60,sizeBytes:nil,maximumWidth:291) == 291)
  precondition(G.audioWidth(duration:2,sizeBytes:nil,maximumWidth:291) == minimum)
  precondition(G.audioWidth(duration:30,sizeBytes:nil,maximumWidth:291) > audio[4])
  let seed=NativeLiveVoiceBubbleGeometry.identity(entityID:"entity",sha256:"sha",draftID:"draft",filename:"f")
  precondition(seed == "entity")
  precondition(NativeLiveVoiceBubbleGeometry.identity(entityID:nil,sha256:"sha",draftID:"draft",filename:"f") == "sha")
  precondition(NativeLiveVoiceBubbleGeometry.identity(entityID:nil,sha256:nil,draftID:"draft",filename:"f") == "draft")
  let wave=G.waveform(identity:seed,width:120)
  precondition(wave == G.waveform(identity:seed,width:120))
  precondition(wave != G.waveform(identity:"different",width:120))
  let wide=G.waveform(identity:seed,width:200)
  precondition(Array(wide.prefix(wave.count)) == wave, "same attachment keeps the same leading bars at any width")
  for width in [0.0,40,80,120,200,1000] {
   let bars=G.waveform(identity:seed,width:width)
   precondition((8...48).contains(bars.count) && bars.allSatisfy{(4...15).contains($0)})
   precondition(CGFloat(bars.count) * (G.waveformBarWidth + G.waveformBarSpacing) - G.waveformBarSpacing <= max(width, 8 * 4 - 2))
   for progress in [0.0,0.25,0.5,1] {
    let filled=bars.indices.filter{G.isFilled(index:$0,count:bars.count,progress:progress)}.count
    precondition(filled == Int(ceil(progress * Double(bars.count))))
   }
  }
  precondition(G.waveformBarWidth >= 1.5 && G.waveformBarWidth <= 2)
  print("Voice geometry PASS widths=\(widths) audio=\(audio) waveform=\(wave)")
 }
}
