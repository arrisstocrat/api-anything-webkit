(() => {
  const job = globalThis.__apiAnythingSessionJob;
  if (!job) throw new Error("Session request context was lost; do not retry a write");
  if (!job.pending) delete globalThis.__apiAnythingSessionJob;
  return job;
})();
