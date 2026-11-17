import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { connection } from "next/server";

export default async function SitesPage() {
     await connection(); 
  const supabase = await createClient();

  // STEP 1: Check who is logged in.
  // Hint: const { data: auth } = await supabase.auth.getClaims();
  // If there is no auth?.claims, call redirect("/login")
    const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) {
    redirect("/login");
  }

  // STEP 2: Fetch the sites.
  // Hint: const { data: sites, error } = await supabase
  //         .from("sites").select("id, name, kind, active").order("name");
    const { data: sites, error } = await supabase
    .from("sites")
    .select("id, name, kind, active")
    .order("name");

  // STEP 3: If there is an error, return a message.
  // Hint: if (error) { return <p>Could not load sites: {error.message}</p>; }
    if (error) {
    return <p className="p-6">Could not load sites: {error.message}</p>;
  }

  // STEP 4: If the list is empty, return "No sites yet".
  // Hint: check !sites || sites.length === 0
    if (!sites || sites.length === 0) {
    return <p className="p-6">No sites yet.</p>;
  }

  // STEP 5: Return the page.
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Sites</h1>

      {/* STEP 6: Show the list.
          Hint: <ul> with sites.map((site) => <li key={site.id}>...</li>)
          Show site.name and site.kind */
                <ul className="space-y-2">
        {sites.map((site) => (
          <li key={site.id} className="border rounded p-3">
            <span className="font-semibold">{site.name}</span>
            <span className="ml-2 text-sm text-gray-500">{site.kind}</span>
          </li>
        ))}
      </ul>}

      <form action={logout}>
        <button className="mt-6 underline">Sign out</button>
      </form>
    </main>
  );
}