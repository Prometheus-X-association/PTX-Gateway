FROM denoland/deno:2.9.6
WORKDIR /app
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY services/knowledge-worker ./services/knowledge-worker
RUN deno cache services/knowledge-worker/main.ts
USER deno
CMD ["deno", "run", "--no-prompt", "--allow-net", "--allow-env", "services/knowledge-worker/main.ts"]
