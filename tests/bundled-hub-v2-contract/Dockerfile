FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# Candidate only; does not modify the production sidecar pin or release channels.
ADD --checksum=sha256:b75ebaa668249148dfa26c4fc8c93d87bc8bfb34ee2fd163fe497b1dd8a096c1 https://registry.npmjs.org/@sleep2agi/commhub-server/-/commhub-server-0.9.0-preview.128.tgz /tmp/hub.tgz
RUN mkdir /candidate && tar -xzf /tmp/hub.tgz -C /candidate --strip-components=1
COPY tests/bundled-hub-v2-contract/probe.ts /fixture/probe.ts
COPY local-hub-sidecar/package.json local-hub-sidecar/package-lock.json /fixture/
COPY src-tauri/src/local_hub.rs /fixture/local_hub.rs
USER bun
CMD ["bun", "/fixture/probe.ts"]
