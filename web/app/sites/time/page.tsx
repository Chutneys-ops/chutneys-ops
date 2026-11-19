import { ComingSoon } from "@/components/coming-soon";

// A static segment ("time") wins over the dynamic [siteId] segment, so this
// page is /sites/time, not a site with the id "time".
export default function TimePage() {
  return <ComingSoon title="Time" blurb="Clock in and out of shifts at each site." />;
}
