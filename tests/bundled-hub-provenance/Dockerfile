FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# TEST ONLY: compare shipped bytes with an exact GitHub main ancestor.
ADD --checksum=sha256:b75ebaa668249148dfa26c4fc8c93d87bc8bfb34ee2fd163fe497b1dd8a096c1 https://registry.npmjs.org/@sleep2agi/commhub-server/-/commhub-server-0.9.0-preview.128.tgz /tmp/hub.tgz
ADD --checksum=sha256:5f7c17f1fb76001c9e01e1c6bdb948e780c92dbe5fd9ca3de546969631ce3e96 https://github.com/sleep2agi/agent-network/archive/e83cfc7d3b949a8751c43ee2f1c0614a2315dcf4.tar.gz /tmp/source.tgz
RUN mkdir /candidate /source && tar -xzf /tmp/hub.tgz -C /candidate --strip-components=1 && tar -xzf /tmp/source.tgz -C /source --strip-components=1
COPY tests/bundled-hub-provenance/probe.mjs /probe.mjs
USER bun
CMD ["bun", "/probe.mjs"]
