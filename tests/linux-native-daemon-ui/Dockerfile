# TEST ONLY. Accepted native startup/auth and installer images are prerequisites.
ARG NATIVE_IMAGE
FROM ${NATIVE_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && test "$TEST_DEB_SHA256" = "$DEB_SHA256"
COPY tests/linux-native-daemon-ui/ui.sh /fixture/daemon-ui.sh
COPY tests/linux-native-daemon-ui/verify.py /fixture/daemon-ui-verify.py
RUN bash -n /fixture/daemon-ui.sh && python3 -m py_compile /fixture/daemon-ui-verify.py
USER smoke
CMD ["sh", "/fixture/keyring.sh", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bash", "/fixture/daemon-ui.sh"]
