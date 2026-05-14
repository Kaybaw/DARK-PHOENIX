import { EventSchemas, Inngest } from "inngest";

export const inngest = new Inngest({
  id: "ai-podcast-clipper-frontend",
  schemas: new EventSchemas().fromRecord<{
    "process-video-events": {
      data: {
        uploadedFileId: string;
        userId: string;
      };
    };
  }>(),
});
