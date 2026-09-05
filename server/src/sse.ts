import type { FastifyReply } from "fastify";

const clients = new Set<FastifyReply>();

/**
 * One broadcast per ingest tick, rather than every browser polling on its own
 * timer. Adding a user costs one open socket, not another round of queries.
 */
export function addClient(reply: FastifyReply) {
  clients.add(reply);
  reply.raw.on("close", () => clients.delete(reply));
}

export function broadcast(event: string, data: unknown) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of clients) {
    try {
      reply.raw.write(frame);
    } catch {
      clients.delete(reply);
    }
  }
}

export const clientCount = () => clients.size;
