CREATE TABLE "group_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_rounds" smallint NOT NULL,
	"player_limit" smallint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"create_request_id" uuid NOT NULL,
	"invite_token_hash" varchar(64) NOT NULL,
	"host_token_hash" varchar(64) NOT NULL,
	"host_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"formation_version" smallint DEFAULT 1 NOT NULL,
	"rule_version" smallint DEFAULT 1 NOT NULL,
	"scoring_version" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "group_matches_create_request_id_unique" UNIQUE("create_request_id"),
	CONSTRAINT "group_matches_total_rounds_check" CHECK ("group_matches"."total_rounds" between 1 and 20),
	CONSTRAINT "group_matches_player_limit_check" CHECK ("group_matches"."player_limit" between 2 and 20),
	CONSTRAINT "group_matches_status_check" CHECK ("group_matches"."status" in ('open', 'closed')),
	CONSTRAINT "group_matches_closed_state_check" CHECK ((
        "group_matches"."status" = 'open' and "group_matches"."closed_at" is null
      ) or (
        "group_matches"."status" = 'closed' and "group_matches"."closed_at" is not null
      )),
	CONSTRAINT "group_matches_invite_token_hash_check" CHECK ("group_matches"."invite_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "group_matches_host_token_hash_check" CHECK ("group_matches"."host_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "group_matches_formation_version_check" CHECK ("group_matches"."formation_version" >= 1),
	CONSTRAINT "group_matches_rule_version_check" CHECK ("group_matches"."rule_version" >= 1),
	CONSTRAINT "group_matches_scoring_version_check" CHECK ("group_matches"."scoring_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "group_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"display_nickname" text NOT NULL,
	"nickname_key" text NOT NULL,
	"auth_token_hash" varchar(64) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"excluded_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "group_participants_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_participants_group_nickname_key_unique" UNIQUE("group_id","nickname_key"),
	CONSTRAINT "group_participants_display_nickname_nonempty_check" CHECK (char_length("group_participants"."display_nickname") > 0),
	CONSTRAINT "group_participants_nickname_key_nonempty_check" CHECK (char_length("group_participants"."nickname_key") > 0),
	CONSTRAINT "group_participants_auth_token_hash_check" CHECK ("group_participants"."auth_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "group_participants_completion_exclusion_check" CHECK ("group_participants"."completed_at" is null or "group_participants"."excluded_at" is null),
	CONSTRAINT "group_participants_version_check" CHECK ("group_participants"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "group_round_attempts" (
	"participant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"round_number" smallint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"captured_coins" smallint DEFAULT 0 NOT NULL,
	"opened_bag_count" smallint DEFAULT 0 NOT NULL,
	"start_request_id" uuid NOT NULL,
	"terminal_request_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "group_round_attempts_participant_round_pk" PRIMARY KEY("participant_id","round_number"),
	CONSTRAINT "group_round_attempts_group_participant_round_unique" UNIQUE("group_id","participant_id","round_number"),
	CONSTRAINT "group_round_attempts_start_request_id_unique" UNIQUE("start_request_id"),
	CONSTRAINT "group_round_attempts_terminal_request_id_unique" UNIQUE("terminal_request_id"),
	CONSTRAINT "group_round_attempts_round_number_check" CHECK ("group_round_attempts"."round_number" between 1 and 20),
	CONSTRAINT "group_round_attempts_status_check" CHECK ("group_round_attempts"."status" in ('active', 'bombed', 'cashed_out', 'cleared', 'interrupted')),
	CONSTRAINT "group_round_attempts_captured_coins_check" CHECK ("group_round_attempts"."captured_coins" between 0 and 3),
	CONSTRAINT "group_round_attempts_opened_bag_count_check" CHECK ("group_round_attempts"."opened_bag_count" between 0 and 8),
	CONSTRAINT "group_round_attempts_state_check" CHECK ((
        "group_round_attempts"."status" = 'active'
        and "group_round_attempts"."ended_at" is null
        and "group_round_attempts"."terminal_request_id" is null
        and "group_round_attempts"."captured_coins" = 0
      ) or (
        "group_round_attempts"."status" = 'bombed'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" = 0
        and "group_round_attempts"."opened_bag_count" between 1 and 8
      ) or (
        "group_round_attempts"."status" = 'cashed_out'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" in (1, 2)
        and "group_round_attempts"."opened_bag_count" between 1 and 8
      ) or (
        "group_round_attempts"."status" = 'cleared'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" = 3
        and "group_round_attempts"."opened_bag_count" between 1 and 8
      ) or (
        "group_round_attempts"."status" = 'interrupted'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" = 0
      )),
	CONSTRAINT "group_round_attempts_version_check" CHECK ("group_round_attempts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "group_round_opens" (
	"participant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"round_number" smallint NOT NULL,
	"open_order" smallint NOT NULL,
	"bag_number" smallint NOT NULL,
	"request_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_round_opens_participant_round_order_pk" PRIMARY KEY("participant_id","round_number","open_order"),
	CONSTRAINT "group_round_opens_group_participant_round_order_unique" UNIQUE("group_id","participant_id","round_number","open_order"),
	CONSTRAINT "group_round_opens_participant_round_bag_unique" UNIQUE("participant_id","round_number","bag_number"),
	CONSTRAINT "group_round_opens_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "group_round_opens_round_number_check" CHECK ("group_round_opens"."round_number" between 1 and 20),
	CONSTRAINT "group_round_opens_open_order_check" CHECK ("group_round_opens"."open_order" between 1 and 8),
	CONSTRAINT "group_round_opens_bag_number_check" CHECK ("group_round_opens"."bag_number" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE "group_round_placements" (
	"group_id" uuid NOT NULL,
	"round_number" smallint NOT NULL,
	"bag_count" smallint NOT NULL,
	"bomb_bag_number" smallint NOT NULL,
	"coin_bag_numbers" smallint[] NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_round_placements_group_round_pk" PRIMARY KEY("group_id","round_number"),
	CONSTRAINT "group_round_placements_round_number_check" CHECK ("group_round_placements"."round_number" between 1 and 20),
	CONSTRAINT "group_round_placements_bag_count_check" CHECK ("group_round_placements"."bag_count" between 3 and 8),
	CONSTRAINT "group_round_placements_bomb_bag_number_check" CHECK ("group_round_placements"."bomb_bag_number" between 1 and "group_round_placements"."bag_count"),
	CONSTRAINT "group_round_placements_source_check" CHECK ("group_round_placements"."source" in ('generated', 'duel-history')),
	CONSTRAINT "group_round_placements_coin_count_check" CHECK (array_ndims("group_round_placements"."coin_bag_numbers") = 1
        and cardinality("group_round_placements"."coin_bag_numbers") = 3
        and array_lower("group_round_placements"."coin_bag_numbers", 1) = 1
        and array_upper("group_round_placements"."coin_bag_numbers", 1) = 3
        and array_position("group_round_placements"."coin_bag_numbers", null) is null),
	CONSTRAINT "group_round_placements_coin_bag_numbers_check" CHECK ((
        ("group_round_placements"."coin_bag_numbers")[1] between 1 and "group_round_placements"."bag_count"
        and ("group_round_placements"."coin_bag_numbers")[2] between 1 and "group_round_placements"."bag_count"
        and ("group_round_placements"."coin_bag_numbers")[3] between 1 and "group_round_placements"."bag_count"
        and ("group_round_placements"."coin_bag_numbers")[1] <> "group_round_placements"."bomb_bag_number"
        and ("group_round_placements"."coin_bag_numbers")[2] <> "group_round_placements"."bomb_bag_number"
        and ("group_round_placements"."coin_bag_numbers")[3] <> "group_round_placements"."bomb_bag_number"
        and ("group_round_placements"."coin_bag_numbers")[1] <= ("group_round_placements"."coin_bag_numbers")[2]
        and ("group_round_placements"."coin_bag_numbers")[2] <= ("group_round_placements"."coin_bag_numbers")[3]
      ))
);
--> statement-breakpoint
ALTER TABLE "group_matches" ADD CONSTRAINT "group_matches_host_participant_id_group_participants_id_fk" FOREIGN KEY ("host_participant_id") REFERENCES "public"."group_participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_participants" ADD CONSTRAINT "group_participants_group_id_group_matches_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_round_attempts" ADD CONSTRAINT "group_round_attempts_participant_fk" FOREIGN KEY ("group_id","participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_round_attempts" ADD CONSTRAINT "group_round_attempts_placement_fk" FOREIGN KEY ("group_id","round_number") REFERENCES "public"."group_round_placements"("group_id","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_round_opens" ADD CONSTRAINT "group_round_opens_attempt_fk" FOREIGN KEY ("group_id","participant_id","round_number") REFERENCES "public"."group_round_attempts"("group_id","participant_id","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_round_placements" ADD CONSTRAINT "group_round_placements_group_id_group_matches_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_matches_invite_token_hash_unique" ON "group_matches" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "group_matches_host_token_hash_unique" ON "group_matches" USING btree ("host_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "group_participants_auth_token_hash_unique" ON "group_participants" USING btree ("auth_token_hash");--> statement-breakpoint
CREATE INDEX "group_participants_group_progress_idx" ON "group_participants" USING btree ("group_id","completed_at","excluded_at");--> statement-breakpoint
CREATE INDEX "group_round_attempts_group_status_idx" ON "group_round_attempts" USING btree ("group_id","status");