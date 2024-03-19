import { CreateBackgroundWorkerRequestBody } from "@trigger.dev/core/v3";
import type { BackgroundWorker } from "@trigger.dev/database";
import { AuthenticatedEnvironment } from "~/services/apiAuth.server";
import { generateFriendlyId } from "../friendlyIdentifiers";
import { BaseService } from "./baseService.server";
import { createBackgroundTasks } from "./createBackgroundWorker.server";
import { CURRENT_DEPLOYMENT_LABEL } from "~/consts";

export class CreateDeployedBackgroundWorkerService extends BaseService {
  public async call(
    projectRef: string,
    environment: AuthenticatedEnvironment,
    deploymentId: string,
    body: CreateBackgroundWorkerRequestBody
  ): Promise<BackgroundWorker | undefined> {
    return this.traceWithEnv("call", environment, async (span) => {
      span.setAttribute("projectRef", projectRef);

      const deployment = await this._prisma.workerDeployment.findUnique({
        where: {
          friendlyId: deploymentId,
        },
      });

      if (!deployment) {
        return;
      }

      const backgroundWorker = await this._prisma.backgroundWorker.create({
        data: {
          friendlyId: generateFriendlyId("worker"),
          version: deployment.version,
          runtimeEnvironmentId: environment.id,
          projectId: environment.projectId,
          metadata: body.metadata,
          contentHash: body.metadata.contentHash,
          cliVersion: body.metadata.cliPackageVersion,
          sdkVersion: body.metadata.packageVersion,
        },
      });

      await createBackgroundTasks(body.metadata.tasks, backgroundWorker, environment, this._prisma);

      // Link the deployment with the background worker
      await this._prisma.workerDeployment.update({
        where: {
          id: deployment.id,
        },
        data: {
          status: "DEPLOYED",
          workerId: backgroundWorker.id,
          deployedAt: new Date(),
        },
      });

      //set this deployment as the current deployment for this environment
      await this._prisma.workerDeploymentPromotion.upsert({
        where: {
          environmentId_label: {
            environmentId: environment.id,
            label: CURRENT_DEPLOYMENT_LABEL,
          },
        },
        create: {
          deploymentId: deployment.id,
          environmentId: environment.id,
          label: CURRENT_DEPLOYMENT_LABEL,
        },
        update: {
          deploymentId: deployment.id,
        },
      });

      return backgroundWorker;
    });
  }
}