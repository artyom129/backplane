import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Layers3 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { FormField, Input, Textarea } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Project } from "@/types";

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createProject = useMutation({
    mutationFn: () =>
      api.post<Project>(
        "/projects",
        { name, description: description || null, create_default_environments: true },
        workspace.headers,
      ),
    onSuccess: async (project) => {
      workspace.setProjectId(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Project could not be created"),
  });

  if (workspace.loading) {
    return (
      <div className="space-y-5 p-6 lg:p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!workspace.organization) {
    return <div className="p-10 text-center text-sm text-muted">No organization is available.</div>;
  }
  if (!workspace.project) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-lg items-center p-6">
        <div className="panel w-full p-6">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/[0.07] text-accent">
            <Layers3 className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-medium text-ink">Create your first project</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Projects isolate endpoints, webhook streams, jobs and incident history. Development,
            staging and production environments will be created automatically.
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createProject.mutate();
            }}
          >
            <FormField label="Project name">
              <Input
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder="Payments Platform"
                required
                value={name}
              />
            </FormField>
            <FormField label="Description" hint="Optional, visible to organization members.">
              <Textarea
                onChange={(event) => setDescription(event.target.value)}
                placeholder="API and webhook operations for payment services."
                value={description}
              />
            </FormField>
            <Button className="w-full" loading={createProject.isPending} type="submit" variant="primary">
              Create project <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </form>
        </div>
      </div>
    );
  }
  return children;
}

