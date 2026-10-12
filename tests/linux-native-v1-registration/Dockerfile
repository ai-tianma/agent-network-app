# TEST ONLY historical exact-package registration evidence, not release proof.
ARG V1_NATIVE_IMAGE
FROM ${V1_NATIVE_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && \
    test "$TEST_DEB_SHA256" = "$DEB_SHA256"
COPY tests/linux-native-opencode-v1/create-ui.sh /fixture/v1-create-ui.sh
COPY tests/linux-native-v1-registration/verify.py /fixture/v1-registration.py
RUN bash -n /fixture/v1-create-ui.sh && python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("/fixture/v1-registration.py").read_text())'
ENV TEST_V1_OBSERVER=/fixture/v1-registration.py
USER smoke
CMD ["sh", "/fixture/keyring.sh", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bash", "/fixture/v1-create-ui.sh"]
