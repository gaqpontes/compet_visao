import React from 'react';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

export function StudioIcon({ name = 'activity', size = 22, color = '#C5F566' }: { name?: 'activity' | 'video' | 'camera' | 'upload' | 'arrow'; size?: number; color?: string }) {
  const paths = {
    activity: 'M3 12h4l3-8 4 16 3-8h4',
    video: 'M15 9l6-3v12l-6-3M4 5h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    camera: 'M8 5l2-2h4l2 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden={true}><Path d={paths[name]} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

export function MovementIllustration() {
  return (
    <Svg width="100%" height={208} viewBox="0 0 440 208" fill="none" aria-hidden={true}>
      <G stroke="#24332C" strokeWidth={1}>
        {[60, 100, 140, 180, 220, 260, 300, 340, 380].map(x => <Line key={`x${x}`} x1={x} y1={16} x2={x} y2={195} />)}
        {[35, 75, 115, 155, 195].map(y => <Line key={`y${y}`} x1={40} y1={y} x2={400} y2={y} />)}
      </G>
      <Circle cx={220} cy={106} r={83} stroke="#A6CF5A" strokeOpacity={0.12} />
      <Circle cx={220} cy={106} r={64} fill="#C5F566" fillOpacity={0.025} stroke="#A6CF5A" strokeOpacity={0.1} strokeDasharray="3 6" />
      <G stroke="#7C9D63" strokeWidth={2} strokeLinecap="round">
        <Path d="M202 66 239 73 228 117 198 114 202 66 178 94 153 78M239 73l25 28 28-22M198 114l-12 36-24 33M228 117l24 29 35 28" />
        <Line x1={220} y1={48} x2={220} y2={69} />
      </G>
      <Path d="m202 66-24 28-25-16" stroke="#C5F566" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={220} cy={37} r={11} stroke="#C5F566" strokeWidth={2} />
      <Path d="M193 65v14M193 79h-13" stroke="#C5F566" strokeOpacity={0.5} strokeDasharray="3 3" />
      {[[202,66],[239,73],[178,94],[153,78],[264,101],[292,79],[198,114],[228,117],[186,150],[162,183],[252,146],[287,174]].map(([x,y],i) => <Circle key={i} cx={x} cy={y} r={3.5} fill={i < 4 ? '#C5F566' : '#87A973'} stroke="#101A15" strokeWidth={1.5} />)}
      <G stroke="#536B4D" strokeWidth={1.5}><Path d="M55 51V31h20M365 31h20v20M55 159v20h20M365 179h20v-20" /></G>
      <Rect x={307} y={54} width={49} height={22} rx={5} fill="#1D2D20" stroke="#456035" />
      <Path d="m320 65 4 4 8-9" stroke="#C5F566" strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={339} y1={62} x2={348} y2={62} stroke="#6F8A5B" /><Line x1={339} y1={67} x2={345} y2={67} stroke="#6F8A5B" />
    </Svg>
  );
}