FROM denoland/deno:2.9.6
WORKDIR /app
COPY deno.lock ./deno.lock
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY services/workflow-worker ./services/workflow-worker
RUN deno cache --unstable-worker-options services/workflow-worker/main.ts
USER deno
CMD ["deno", "run", "--no-prompt", "--unstable-worker-options", "--allow-net", "--allow-env", "--v8-flags=--max-old-space-size=256", "services/workflow-worker/main.ts"]
