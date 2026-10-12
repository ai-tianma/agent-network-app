# TEST ONLY. The native image must first pass native startup/authentication.
ARG NATIVE_IMAGE
ARG PAIR_IMAGE
FROM ${PAIR_IMAGE} AS packages
FROM ${NATIVE_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && \
    test "$TEST_DEB_SHA256" = "$DEB_SHA256"
# Full Node + npm, not only the node executable. Packages are installed by the
# product installer at runtime; only their normal npm download cache is seeded.
COPY --from=packages /usr/local/ /usr/local/
COPY --from=packages --chown=10001:10001 /home/node/.npm/ /home/smoke/.npm/
COPY --from=packages --chown=10001:10001 /home/node/.anet/app/local-daemon/anet/ /fixture/exact-prefix/
COPY tests/linux-native-daemon/run.sh /fixture/native-daemon.sh
COPY tests/linux-native-daemon/verify.mjs /fixture/daemon-verify.mjs
COPY scripts/with-linux-test-keyring.sh /fixture/keyring.sh
COPY src-tauri/src/local_daemon_packages.rs /fixture/daemon-policy.rs
RUN bash -n /fixture/native-daemon.sh && node --check /fixture/daemon-verify.mjs
USER smoke
ENV npm_config_offline=true npm_config_audit=false npm_config_fund=false
ENV ANET_PACKAGED_SMOKE_ROOT=/home/smoke/native-daemon-test
CMD ["sh", "/fixture/keyring.sh", "bash", "/fixture/native-daemon.sh", "empty"]
