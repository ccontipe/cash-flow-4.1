#!/bin/bash
# Cria filas SQS no LocalStack usando curl (sem depender de awslocal instalado)
set -e

ENDPOINT="http://localhost:4566"
REGION="sa-east-1"
ACCOUNT="000000000000"

echo "[localstack-init] Creating SQS queues..."

# DLQ primeiro
curl -sf -X POST "${ENDPOINT}/" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "Action=CreateQueue" \
  --data-urlencode "QueueName=lancamentos-dlq" \
  --data-urlencode "Version=2012-11-05" > /dev/null

echo "[localstack-init] DLQ created"

# Fila principal com RedrivePolicy apontando para DLQ
DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT}:lancamentos-dlq"
REDRIVE="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"3\"}"

curl -sf -X POST "${ENDPOINT}/" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "Action=CreateQueue" \
  --data-urlencode "QueueName=lancamentos-queue" \
  --data-urlencode "Attribute.1.Name=RedrivePolicy" \
  --data-urlencode "Attribute.1.Value=${REDRIVE}" \
  --data-urlencode "Version=2012-11-05" > /dev/null

echo "[localstack-init] Main queue created"
echo "[localstack-init] SQS setup complete"
