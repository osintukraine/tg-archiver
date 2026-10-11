#!/bin/sh
# SeaweedFS all-in-one (master + volume + filer + S3 gateway) for tg-archiver.
#
# Renders the S3 identity config from env vars, then starts `weed server`:
#   - "archiver": full access, used by listener/processor/api (MINIO_* vars)
#   - "anonymous": read-only on the media bucket, so Caddy can serve /media/*
#     without credentials (replaces `mc anonymous set download`)
set -eu

: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
: "${S3_PUBLIC_BUCKET:?S3_PUBLIC_BUCKET is required}"

# Values are embedded in JSON below; reject characters that would break it.
for value in "$S3_ACCESS_KEY" "$S3_SECRET_KEY" "$S3_PUBLIC_BUCKET"; do
  case "$value" in
    *\"* | *\\*)
      echo "S3 credentials and bucket name must not contain '\"' or '\\'" >&2
      exit 1
      ;;
  esac
done

CONFIG=/tmp/s3.json
cat > "$CONFIG" <<EOF
{
  "identities": [
    {
      "name": "archiver",
      "credentials": [
        { "accessKey": "$S3_ACCESS_KEY", "secretKey": "$S3_SECRET_KEY" }
      ],
      "actions": ["Admin", "Read", "List", "Tagging", "Write"]
    },
    {
      "name": "anonymous",
      "actions": ["Read:$S3_PUBLIC_BUCKET"]
    }
  ]
}
EOF
chmod 600 "$CONFIG"

exec weed server -dir=/data -s3 -s3.port=8333 -s3.config="$CONFIG"
