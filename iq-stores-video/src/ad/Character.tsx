import React from "react";
import { C, bob } from "./kit";

// Flat-vector character: a young Iraqi man, built from simple shapes with
// minimal facial detail. Reads local through the hair line, trimmed beard
// and warm skin tone rather than through props or clichés. Same rig in
// every scene — only the pose parameters change, so he never turns into a
// different person between shots.
//
// Poses:
//   'slumped'  — shoulders down, head bent over the phone (scene 1)
//   'upright'  — sits up, phone held in front (scenes 2–4)
//   'raised'   — phone held up, pleased (scene 5)

export type Pose = "slumped" | "upright" | "raised";

const POSE = {
  slumped: { shoulder: 16, headTilt: 13, headY: 10, armAngle: -8, phoneY: 8 },
  upright: { shoulder: 0, headTilt: 2, headY: 0, armAngle: 0, phoneY: 0 },
  raised: { shoulder: -6, headTilt: -6, headY: -6, armAngle: -26, phoneY: -46 },
} as const;

export const Character: React.FC<{
  pose: Pose;
  frame: number;
  /** 0→1 blend from the previous pose, so shots don't snap. */
  blend?: number;
  fromPose?: Pose;
  /** Hide the phone when the scene shows the UI at full size instead. */
  showPhone?: boolean;
  /** Rendered height in px; width follows the rig's 420:520 aspect, so the
      figure always fills the space a scene gives it. */
  height: number;
}> = ({ pose, frame, blend = 1, fromPose = "slumped", showPhone = true, height }) => {
  const a = POSE[fromPose];
  const b = POSE[pose];
  const mix = (k: keyof typeof a) => a[k] + (b[k] - a[k]) * blend;

  const shoulder = mix("shoulder");
  const headTilt = mix("headTilt");
  const headY = mix("headY");
  const armAngle = mix("armAngle");
  const phoneY = mix("phoneY");

  // Idle breathing — subtle, never competing with the scene's own motion.
  const breathe = bob(frame, 2.2, 110);

  return (
    <svg
      viewBox="0 0 420 520"
      width={height * (420 / 520)}
      height={height}
      style={{ overflow: "visible" }}
    >
      {/* Seat / ground shadow: an ellipse, keeps him grounded without a set */}
      <ellipse cx="210" cy="486" rx="132" ry="20" fill="rgba(27,26,24,0.10)" />

      <g transform={`translate(0 ${breathe})`}>
        {/* ── Legs ── two separate legs; a single trapezoid read as a robe */}
        <path
          d="M152 360 L196 360 L192 462 L156 462 Z"
          fill="#2E2A26"
        />
        <path
          d="M224 360 L268 360 L264 462 L228 462 Z"
          fill="#2E2A26"
        />
        {/* Shoes */}
        <rect x="140" y="456" width="62" height="22" rx="11" fill={C.ink} />
        <rect x="218" y="456" width="62" height="22" rx="11" fill={C.ink} />

        {/* ── Torso ── casual crew-neck tee in the brand accent */}
        <g transform={`translate(0 ${shoulder})`}>
          <path
            d="M210 176
               C 168 176 138 200 132 240
               L 120 352
               C 118 366 128 378 142 378
               L 278 378
               C 292 378 302 366 300 352
               L 288 240
               C 282 200 252 176 210 176 Z"
            fill={C.accent}
          />
          {/* Neckline */}
          <path
            d="M182 180 C 196 202 224 202 238 180 C 228 174 192 174 182 180 Z"
            fill={C.deep}
          />
          {/* Fold detail — one line, keeps the tee from reading as a blob */}
          <path
            d="M158 300 C 186 314 234 314 262 300"
            stroke={C.deep}
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
            opacity={0.55}
          />

          {/* ── Arms ── upper arm hangs, forearm angles in so the hand
              lands on the phone's edge rather than floating beside it. */}
          <g transform={`rotate(${armAngle} 146 262)`}>
            <path
              d="M132 232 C 120 262 122 292 132 312 L 166 302 C 158 282 156 258 164 238 Z"
              fill={C.deep}
            />
            <path
              d="M132 302 C 146 330 160 342 178 348 L 190 318 C 172 312 160 302 152 290 Z"
              fill={C.deep}
            />
            <circle cx="186" cy="336" r="18" fill={C.skin} />
          </g>
          <g transform={`rotate(${-armAngle} 274 262)`}>
            <path
              d="M288 232 C 300 262 298 292 288 312 L 254 302 C 262 282 264 258 256 238 Z"
              fill={C.deep}
            />
            <path
              d="M288 302 C 274 330 260 342 242 348 L 230 318 C 248 312 260 302 268 290 Z"
              fill={C.deep}
            />
            <circle cx="234" cy="336" r="18" fill={C.skin} />
          </g>
        </g>

        {/* ── Head ── */}
        <g transform={`translate(0 ${headY + shoulder}) rotate(${headTilt} 210 120)`}>
          {/* Neck */}
          <rect x="192" y="150" width="36" height="34" rx="14" fill={C.skinDark} />
          {/* Face */}
          <rect x="158" y="56" width="104" height="118" rx="46" fill={C.skin} />
          {/* Ear */}
          <circle cx="158" cy="118" r="12" fill={C.skinDark} />
          {/* Trimmed beard along the jaw — the main "local" read, kept as a
              soft shape rather than drawn hair */}
          <path
            d="M162 118
               C 162 168 182 180 210 180
               C 238 180 262 168 262 118
               C 262 150 244 158 210 158
               C 176 158 162 150 162 118 Z"
            fill={C.ink}
            opacity={0.88}
          />
          <path
            d="M186 150 C 196 162 224 162 234 150 C 226 168 194 168 186 150 Z"
            fill={C.ink}
            opacity={0.5}
          />
          {/* Hair — thick, dark, short at the sides with a little volume */}
          <path
            d="M156 104
               C 150 60 178 40 210 40
               C 244 40 270 60 264 104
               C 258 86 246 78 210 78
               C 176 78 164 86 156 104 Z"
            fill={C.ink}
          />
          {/* Brows + eyes: two strokes and two dots is all the face needs */}
          <rect x="176" y="104" width="24" height="6" rx="3" fill={C.ink} opacity={0.85} />
          <rect x="222" y="104" width="24" height="6" rx="3" fill={C.ink} opacity={0.85} />
          <circle cx="188" cy="122" r="6.5" fill={C.ink} />
          <circle cx="234" cy="122" r="6.5" fill={C.ink} />
          {/* Mouth changes with the mood: flat when slumped, a smile when raised */}
          {pose === "raised" ? (
            <path
              d="M194 142 C 204 152 218 152 228 142"
              stroke={C.ink}
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            <rect x="198" y="143" width="26" height="5" rx="2.5" fill={C.ink} opacity={0.75} />
          )}
        </g>

        {/* ── Phone in hand ── */}
        {showPhone ? (
          <g transform={`translate(0 ${phoneY + shoulder})`}>
            <rect x="178" y="272" width="64" height="112" rx="13" fill={C.ink} />
            <rect x="184" y="278" width="52" height="100" rx="9" fill={C.surface} />
            {/* The app, abstracted: a header bar and two listing rows */}
            <rect x="190" y="286" width="40" height="8" rx="4" fill={C.accent} />
            <rect x="190" y="300" width="40" height="24" rx="6" fill="#E2DBCB" />
            <rect x="190" y="330" width="40" height="24" rx="6" fill="#E2DBCB" />
            <rect x="190" y="360" width="24" height="8" rx="4" fill="#E2DBCB" />
          </g>
        ) : null}
      </g>
    </svg>
  );
};
