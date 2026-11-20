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

export type RosterPublishedAlert = {
  weekId: string;
  siteId: string;
  /** The Monday, "YYYY-MM-DD". */
  weekStart: string;
  /** Everyone rostered that week at that site. */
  staffIds: string[];
  /** false: first publish ("Your shifts for the week of ... are up").
   *  true: a published week changed and was published again ("Your shifts changed"). */
  republished: boolean;
};

/** Tell the people on a week's roster that it has been published, or that a
 *  published week has changed. Called by the roster's Publish / Re-publish
 *  action AFTER publish_roster_week succeeds. */
export async function notifyRosterPublished(alert: RosterPublishedAlert): Promise<void> {
  // TODO(slice 7): push "Your shifts for the week of <date> are up" (or
  // "Your shifts changed") to each person in staffIds who has turned
  // notifications on, opening /time. Never let a failed push fail the
  // publish: catch and log here.
  void alert;
}
