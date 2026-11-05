import dgram from "node:dgram";

export function pixelOfficeTarget(env = process.env) {
  return {
    httpUrl: env.PIXEL_OFFICE_HTTP ?? "http://127.0.0.1:3003/api/events",
    udpHost: env.PIXEL_OFFICE_UDP_HOST ?? "127.0.0.1",
    udpPort: Number(env.PIXEL_OFFICE_UDP_PORT ?? 9997),
  };
}

export function createPixelOfficeForwarder(target = pixelOfficeTarget(), { fetchImpl = fetch } = {}) {
  const socket = dgram.createSocket("udp4");
  return {
    async send(event) {
      const body = JSON.stringify(event);
      let httpOk = false;
      let udpOk = false;
      try {
        const response = await fetchImpl(target.httpUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(800),
        });
        httpOk = response.ok;
      } catch {
        httpOk = false;
      }
      try {
        await new Promise((resolve, reject) => {
          socket.send(Buffer.from(body), target.udpPort, target.udpHost, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        udpOk = true;
      } catch {
        udpOk = false;
      }
      return { httpOk, udpOk };
    },
    close() {
      socket.close();
    },
  };
}
