# Local api image: the published Dograh image plus this repo's Python
# requirements, so pins in api/requirements.txt (e.g. google-genai 2.28)
# survive container recreation. Source code is mounted by the override file.
ARG BASE_IMAGE=ghcr.io/dograh-hq/dograh-api:latest
FROM ${BASE_IMAGE}

# --no-deps: only the pinned packages change. Resolving dependencies lets
# tuner-pipecat-sdk pull pipecat-ai from PyPI over the image's forked Pipecat,
# and the app then fails on `pipecat.utils.run_context`. The import check
# fails the build if a pin needs something the base image doesn't have.
USER root
COPY api/requirements.txt /tmp/awaz-requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir --no-deps -r /tmp/awaz-requirements.txt \
    && rm /tmp/awaz-requirements.txt \
    && /opt/venv/bin/python -c "import google.genai, pipecat.utils.run_context, fastembed, pypdf, bs4"

# Knowledge-base models run locally (embeddings and reranking take milliseconds
# instead of an API round trip). Bake them into the image so the first call
# never waits on a download.
ENV FASTEMBED_CACHE_PATH=/opt/awaz-models
RUN /opt/venv/bin/python -c "from fastembed import TextEmbedding; from fastembed.rerank.cross_encoder import TextCrossEncoder; TextEmbedding('BAAI/bge-small-en-v1.5'); TextCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2')" \
    && chmod -R a+rX /opt/awaz-models
USER dograh
