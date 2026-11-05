import path from "node:path";
import { fileURLToPath } from "node:url";

// Walks HR then PM through the poses the 3D client can show.
// The spike server must already be listening.

export const DEMO_STEPS = [
  { role: "HR", phase: "appear" },
  { role: "PM", phase: "appear" },
  { role: "HR", phase: "waiting" },
  { role: "PM", phase: "coding" },
  { role: "PM", phase: "pr" },
];

const base = process.env.SPIKE_URL ?? "http://127.0.0.1:4600";
const delayMs = Number(process.env.SPIKE_DELAY ?? 1200);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDemo({ url = base, delay = delayMs, log = console.log } = {}) {
  for (const step of DEMO_STEPS) {
    const res = await fetch(`${url}/api/spike/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(step),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${step.role} ${step.phase}: ${res.status} ${body.error ?? ""}`.trim());
    log(`${step.role} ${step.phase} → ${body.worker.status}${body.worker.action ? ` ${body.worker.action}` : ""}`);
    if (delay > 0) await sleep(delay);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDemo().catch((error) => {
    console.error(error.message);
    console.error(`Is the spike server up at ${base}? npm run spike:office`);
    process.exit(1);
  });
}
