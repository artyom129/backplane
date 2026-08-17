import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Organization, OrganizationMember, Project, Role } from "@/types";

export function SettingsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [organizationName, setOrganizationName] = useState(workspace.organization?.name ?? "");
  const [projectName, setProjectName] = useState(workspace.project?.name ?? "");
  const [description, setDescription] = useState(workspace.project?.description ?? "");
  const [memberOpen, setMemberOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const canAdmin = ["owner", "admin"].includes(workspace.organization?.role ?? "viewer");

  useEffect(() => {
    setOrganizationName(workspace.organization?.name ?? "");
    setProjectName(workspace.project?.name ?? "");
    setDescription(workspace.project?.description ?? "");
  }, [workspace.organization, workspace.project]);

  const members = useQuery({
    queryKey: ["organization-members", workspace.organization?.id],
    queryFn: () => api.get<OrganizationMember[]>("/organizations/members", workspace.headers),
    enabled: Boolean(workspace.organization),
  });
  const updateOrganization = useMutation({
    mutationFn: () => api.patch<Organization>("/organizations/current", { name: organizationName }, workspace.headers),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      toast.success("Organization updated");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Organization could not be updated"),
  });
  const updateProject = useMutation({
    mutationFn: () => api.patch<Project>(`/projects/${workspace.project?.id}`, { name: projectName, description: description || null }, workspace.headers),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project updated");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Project could not be updated"),
  });
  const addMember = useMutation({
    mutationFn: () => api.post<OrganizationMember>("/organizations/members", { email, role }, workspace.headers),
    onSuccess: async () => {
      setMemberOpen(false);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      toast.success("Member added");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Member could not be added"),
  });
  const updateMember = useMutation({
    mutationFn: ({ memberId, nextRole }: { memberId: string; nextRole: Role }) =>
      api.patch<OrganizationMember>(`/organizations/members/${memberId}`, { role: nextRole }, workspace.headers),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization-members"] });
      toast.success("Member role updated");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Role could not be updated"),
  });

  return (
    <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8">
      <PageHeader breadcrumbs={[{ label: "System" }, { label: "Settings" }]} description="Workspace identity, project metadata and organization access." title="Settings" />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Organization" description="Shared identity for projects and members" />
          <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <FormField label="Organization name"><Input disabled={!canAdmin} onChange={(event) => setOrganizationName(event.target.value)} value={organizationName} /></FormField>
            <Button disabled={!canAdmin || !organizationName} loading={updateOrganization.isPending} onClick={() => updateOrganization.mutate()} variant="secondary"><Save className="h-3.5 w-3.5" /> Save</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Project" description="Metadata visible to organization members" />
          <div className="space-y-4 p-5">
            <FormField label="Project name"><Input disabled={!workspace.canWrite} onChange={(event) => setProjectName(event.target.value)} value={projectName} /></FormField>
            <FormField label="Description"><Textarea disabled={!workspace.canWrite} onChange={(event) => setDescription(event.target.value)} value={description} /></FormField>
            <div className="flex justify-end"><Button disabled={!workspace.canWrite || !projectName} loading={updateProject.isPending} onClick={() => updateProject.mutate()} variant="secondary"><Save className="h-3.5 w-3.5" /> Save project</Button></div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader action={canAdmin ? <Button onClick={() => setMemberOpen(true)} size="sm" variant="secondary"><Plus className="h-3 w-3" /> Add member</Button> : undefined} title="Members" description="Backend-enforced roles across the organization" />
          {members.isLoading ? (
            <TableSkeleton rows={5} />
          ) : (
            members.data?.map((member) => (
              <div className="data-row flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" key={member.id}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-[10px] font-medium text-[#cbd2d8]">{member.full_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1"><div className="text-xs font-medium text-[#d8dde2]">{member.full_name}</div><div className="mt-0.5 text-[10px] text-muted">{member.email}</div></div>
                {canAdmin ? (
                  <Select className="h-8 min-h-0 w-32 text-xs" disabled={member.role === "owner" && workspace.organization?.role !== "owner"} onChange={(event) => updateMember.mutate({ memberId: member.id, nextRole: event.target.value as Role })} value={member.role}><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option>{workspace.organization?.role === "owner" && <option value="owner">Owner</option>}</Select>
                ) : (
                  <Badge tone="neutral">{member.role}</Badge>
                )}
              </div>
            ))
          )}
        </Card>
      </div>

      <Dialog
        footer={<><Button onClick={() => setMemberOpen(false)} variant="ghost">Cancel</Button><Button disabled={!email} loading={addMember.isPending} onClick={() => addMember.mutate()} variant="primary">Add member</Button></>}
        onClose={() => setMemberOpen(false)}
        open={memberOpen}
        title="Add organization member"
        description="The user must already have a BACKPLANE account."
      >
        <div className="space-y-4">
          <FormField label="Email"><Input autoFocus onChange={(event) => setEmail(event.target.value)} placeholder="engineer@company.com" type="email" value={email} /></FormField>
          <FormField label="Role"><Select onChange={(event) => setRole(event.target.value as Role)} value={role}><option value="viewer">Viewer — read only</option><option value="developer">Developer — operate resources</option><option value="admin">Admin — manage access and keys</option>{workspace.organization?.role === "owner" && <option value="owner">Owner — full control</option>}</Select></FormField>
        </div>
      </Dialog>
    </div>
  );
}
