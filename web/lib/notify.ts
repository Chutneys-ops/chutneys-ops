// Phone notifications. Nothing is sent yet: this is the hook slice 7 fills in.
//
// Called by the "New notice" server action AFTER the notice is saved, so a
// failed save never notifies anyone. Editing a notice doesn't notify.

export type NewNoticeAlert = {
  id: string;
  title: string;
  /** null = everyone; otherwise send to people who chose these sites recently
   *  (audienceFor in lib/notices.ts has the rule). */
  siteIds: string[] | null;
  needsAck: boolean;
};

/** Tell the notice's audience that a new notice is up. */
export async function notifyNewNotice(notice: NewNoticeAlert): Promise<void> {
  // TODO(slice 7): send a push notification ("New notice: <title>", opening
  // /notices/<id>) to everyone in the audience who has turned notifications
  // on. Never let a failed push fail the post: catch and log here.
  void notice;
}
