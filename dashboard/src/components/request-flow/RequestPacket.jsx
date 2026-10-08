import { useEffect, useRef, useState } from "react";

// The traveling packet: a hidden geometry <path> (for getPointAtLength),
// a visible foreground path that "fills in" behind the packet via the
// classic stroke-dasharray/dashoffset line-draw trick, and the packet
// marker itself - a glowing dot for a request/chunk, a small pill for a
// response. Everything here is pure presentation; `activeTravel` (from
// useFlowSimulation) is the only input.
export default function RequestPacket({ activeTravel }) {
  const geometryRef = useRef(null);
  const [length, setLength] = useState(0);
  const [point, setPoint] = useState(null);

  const d = activeTravel?.d;

  useEffect(() => {
    if (!geometryRef.current || !d) {
      setLength(0);
      return;
    }
    setLength(geometryRef.current.getTotalLength());
  }, [d]);

  useEffect(() => {
    if (!geometryRef.current || !activeTravel || !length) {
      setPoint(null);
      return;
    }
    const { progress, reverse } = activeTravel;
    const at = reverse ? length * (1 - progress) : length * progress;
    setPoint(geometryRef.current.getPointAtLength(at));
  }, [activeTravel, length]);

  if (!activeTravel) return null;

  const { progress, reverse, color, packetType } = activeTravel;
  // Dash offset draws the foreground path in from the packet's starting
  // end, regardless of travel direction - this is the "fills behind the
  // packet, leaving a trail" effect.
  const drawn = reverse ? length * progress : length * (1 - progress);

  return (
    <g>
      {/* Invisible - exists only so we can call getPointAtLength on it. */}
      <path ref={geometryRef} d={d} fill="none" stroke="none" />

      {/* The "fills behind the packet" trail. */}
      {length > 0 && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          opacity={0.85}
          style={{
            strokeDasharray: length,
            strokeDashoffset: reverse ? length - drawn : drawn,
            transition: "stroke-dashoffset 60ms linear",
          }}
        />
      )}

      {point && (
        <g style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
          {packetType === "response" ? (
            <g>
              <rect x={-26} y={-10} width={52} height={20} rx={10} fill={color} opacity={0.18} />
              <rect x={-22} y={-7} width={44} height={14} rx={7} fill={color} />
              <text x={0} y={4} textAnchor="middle" fontSize={8} fontWeight={700} fill="white" letterSpacing={0.3}>
                RESP
              </text>
            </g>
          ) : (
            <g>
              <circle r={packetType === "chunk" ? 9 : 12} fill={color} opacity={0.22} />
              <circle r={packetType === "chunk" ? 5 : 6} fill={color} />
              <circle r={packetType === "chunk" ? 2 : 2.5} fill="white" opacity={0.85} />
            </g>
          )}
        </g>
      )}
    </g>
  );
}
