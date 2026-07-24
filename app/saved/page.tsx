import { WebShell } from "@/components/WebShell";
import { SavedPageContent } from "@/components/saved-page-content";

export const metadata = {
  title: "Saved — FlowRyd",
};

export default function SavedPage() {
  return (
    <WebShell>
      <SavedPageContent />
    </WebShell>
  );
}
