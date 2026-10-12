FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# Candidate only; does not modify the production sidecar pin or release channels.
ADD --checksum=sha256:ef9ed47cff0a1d6b65ef100dbf684f4e2c430e802ee75809bdb4db3c62fc6e54 https://registry.npmjs.org/@sleep2agi/commhub-server/-/commhub-server-0.9.0-preview.127.tgz /tmp/hub.tgz
RUN mkdir /candidate && tar -xzf /tmp/hub.tgz -C /candidate --strip-components=1
COPY tests/bundled-hub-v2-contract/probe.ts /fixture/probe.ts
COPY local-hub-sidecar/package.json local-hub-sidecar/package-lock.json /fixture/
COPY src-tauri/src/local_hub.rs /fixture/local_hub.rs
USER bun
CMD ["bun", "/fixture/probe.ts"]
