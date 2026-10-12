FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-yaml && rm -rf /var/lib/apt/lists/*
COPY .github/workflows/linux-deb-package.yml /fixture/workflow.yml
COPY tests/linux-native-v1-candidate-runtime/Dockerfile /fixture/candidate.Dockerfile
COPY tests/linux-native-v1-candidate-runtime/manifest.mjs /fixture/manifest.mjs
COPY tests/linux-native-v1-model/Dockerfile /fixture/model.Dockerfile
COPY tests/linux-native-v1-ci/verify.py /fixture/verify.py
USER bun
CMD ["python3", "/fixture/verify.py"]
