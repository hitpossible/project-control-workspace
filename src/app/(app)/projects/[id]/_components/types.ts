import type {
  Activity, Baseline, BaselineItem, BaselineRevision, Bug, BugFix, Evidence, EvidenceRequirement, InternalTask, Profile,
  ProjectClosure, ProjectMember, ProjectView, Retest, TaskDependency, TestRound,
} from '@/lib/types';

export interface ProjectData {
  project: ProjectView;
  activities: Activity[];
  members: ProjectMember[];
  baselines: Baseline[];
  baselineItems: BaselineItem[];
  revisions: BaselineRevision[];
  /** closure sign-off rounds, newest first */
  closures: ProjectClosure[];
  tasks: InternalTask[];
  deps: TaskDependency[];
  requirements: EvidenceRequirement[];
  evidence: Evidence[];
  rounds: TestRound[];
  bugs: Bug[];
  fixes: BugFix[];
  retests: Retest[];
}

export interface TabProps {
  data: ProjectData;
  perm: { internal: boolean; manage: boolean };
  reload: () => Promise<void>;
  memberProfiles: Profile[];
}
