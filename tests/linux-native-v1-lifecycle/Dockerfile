# TEST ONLY: native V1 lifecycle after the selected-model candidate prerequisite.
ARG V1_CANDIDATE_IMAGE
FROM ${V1_CANDIDATE_IMAGE}
USER root
COPY tests/linux-native-v1-model/verify.py /fixture/v1-model-verify.py
COPY tests/linux-native-v1-lifecycle/verify.py /fixture/v1-lifecycle-verify.py
COPY tests/linux-native-v1-lifecycle/run.sh /fixture/v1-lifecycle-run.sh
RUN bash -n /fixture/v1-lifecycle-run.sh && python3 -c 'import ast,pathlib; [ast.parse(pathlib.Path(p).read_text()) for p in ["/fixture/v1-model-verify.py", "/fixture/v1-lifecycle-verify.py"]]'
USER smoke
CMD ["sh", "/fixture/keyring.sh", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bash", "/fixture/v1-lifecycle-run.sh"]
