import { env } from "~/env";
import { inngest } from "./client";
import { db } from "~/server/db";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

export const processVideo = inngest.createFunction(
  {
    id: "process-video",
    retries: 1,
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
  },
  { event: "process-video-events" },
  async ({ event, step }) => {
    const { uploadedFileId } = event.data;

    try {
      console.log("processVideo started:", { uploadedFileId });

      const { userId, credits, s3Key } = await step.run(
        "check-credits",
        async () => {
          const uploadedFile = await db.uploadedFile.findUniqueOrThrow({
            where: { id: uploadedFileId },
            select: {
              user: {
                select: {
                  id: true,
                  credits: true,
                },
              },
              s3Key: true,
            },
          });

          return {
            userId: uploadedFile.user.id,
            credits: uploadedFile.user.credits,
            s3Key: uploadedFile.s3Key,
          };
        },
      );

      console.log("processVideo check-credits result:", {
        userId,
        credits,
        s3Key,
      });

      if (credits <= 0) {
        await step.run("set-status-no-credits", async () => {
          await db.uploadedFile.update({
            where: { id: uploadedFileId },
            data: { status: "no credits" },
          });
        });

        return;
      }

      await step.run("set-status-processing", async () => {
        await db.uploadedFile.update({
          where: { id: uploadedFileId },
          data: { status: "processing" },
        });
      });

      console.log("processVideo calling endpoint:", {
        endpoint: env.PROCESS_VIDEO_ENDPOINT,
        hasAuth: Boolean(env.PROCESS_VIDEO_ENDPOINT_AUTH),
        s3Key,
      });

      const processRes = await step.fetch(env.PROCESS_VIDEO_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ s3_key: s3Key }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.PROCESS_VIDEO_ENDPOINT_AUTH}`,
        },
      });

      const processBody = await processRes.text();

      console.log("processVideo endpoint response:", {
        status: processRes.status,
        ok: processRes.ok,
        body: processBody.slice(0, 500),
      });

      if (!processRes.ok) {
        throw new Error(
          `PROCESS_VIDEO_ENDPOINT returned ${processRes.status}: ${processBody.slice(
            0,
            500,
          )}`,
        );
      }

      const { clipsFound } = await step.run("create-clips-in-db", async () => {
        const folderPrefix = s3Key.split("/")[0]!;
        const allKeys = await listS3ObjectsByPrefix(folderPrefix);

        console.log("processVideo S3 objects found:", allKeys);

        const clipKeys = allKeys.filter(
          (key): key is string =>
            key !== undefined && !key.endsWith("original.mp4"),
        );

        console.log("processVideo clip keys found:", clipKeys);

        if (clipKeys.length > 0) {
          await db.clip.createMany({
            data: clipKeys.map((clipKey) => ({
              s3Key: clipKey,
              uploadedFileId,
              userId,
            })),
          });
        }

        return { clipsFound: clipKeys.length };
      });

      await step.run("deduct-credits", async () => {
        await db.user.update({
          where: { id: userId },
          data: {
            credits: {
              decrement: Math.min(credits, clipsFound),
            },
          },
        });
      });

      await step.run("set-status-processed", async () => {
        await db.uploadedFile.update({
          where: { id: uploadedFileId },
          data: { status: "processed" },
        });
      });

      console.log("processVideo completed:", {
        uploadedFileId,
        clipsFound,
      });
    } catch (error: unknown) {
      console.error("processVideo failed:", error);

      await db.uploadedFile.update({
        where: { id: uploadedFileId },
        data: { status: "failed" },
      });

      throw error;
    }
  },
);

async function listS3ObjectsByPrefix(prefix: string) {
  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const listCommand = new ListObjectsV2Command({
    Bucket: env.S3_BUCKET_NAME,
    Prefix: prefix,
  });

  const response = await s3Client.send(listCommand);

  return response.Contents?.map((item) => item.Key).filter(Boolean) ?? [];
}