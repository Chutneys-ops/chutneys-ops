import { redirect } from "next/navigation";

// There is no home page yet: send everyone to the sites list.
// /sites itself sends signed-out visitors on to /login.
export default function Home() {
  redirect("/sites");
}
