CREATE TABLE "daily_challenge_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_date" date NOT NULL,
	"display_nickname" text NOT NULL,
	"nickname_key" text NOT NULL,
	"auth_token_hash" varchar(64) NOT NULL,
	"join_request_id" uuid NOT NULL,
	"question_order" smallint[] NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_participants_date_id_unique" UNIQUE("challenge_date","id"),
	CONSTRAINT "daily_participants_join_request_unique" UNIQUE("join_request_id"),
	CONSTRAINT "daily_participants_display_nickname_nonempty_check" CHECK (char_length("daily_challenge_participants"."display_nickname") > 0),
	CONSTRAINT "daily_participants_nickname_key_nonempty_check" CHECK (char_length("daily_challenge_participants"."nickname_key") > 0),
	CONSTRAINT "daily_participants_auth_token_hash_check" CHECK ("daily_challenge_participants"."auth_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "daily_participants_question_order_check" CHECK (array_ndims("daily_challenge_participants"."question_order") = 1
        and cardinality("daily_challenge_participants"."question_order") = 20
        and array_lower("daily_challenge_participants"."question_order", 1) = 1
        and array_upper("daily_challenge_participants"."question_order", 1) = 20
        and array_position("daily_challenge_participants"."question_order", null) is null
        and "daily_challenge_participants"."question_order" @> array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
          11, 12, 13, 14, 15, 16, 17, 18, 19, 20]::smallint[]),
	CONSTRAINT "daily_participants_completion_expiry_check" CHECK ("daily_challenge_participants"."completed_at" is null or "daily_challenge_participants"."expired_at" is null),
	CONSTRAINT "daily_participants_completion_deadline_check" CHECK ("daily_challenge_participants"."completed_at" is null or "daily_challenge_participants"."completed_at" <
        ("daily_challenge_participants"."challenge_date"::timestamp at time zone 'UTC') + interval '1 day'),
	CONSTRAINT "daily_participants_version_check" CHECK ("daily_challenge_participants"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_challenge_round_attempts" (
	"participant_id" uuid NOT NULL,
	"challenge_date" date NOT NULL,
	"round_number" smallint NOT NULL,
	"challenge_round_number" smallint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"elapsed_seconds" smallint,
	"captured_coins" smallint,
	"opened_bag_count" smallint DEFAULT 0 NOT NULL,
	"coin_bag_hits" smallint,
	"start_request_id" uuid NOT NULL,
	"terminal_request_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_attempts_participant_round_pk" PRIMARY KEY("participant_id","round_number"),
	CONSTRAINT "daily_attempts_date_participant_round_unique" UNIQUE("challenge_date","participant_id","round_number"),
	CONSTRAINT "daily_attempts_start_request_unique" UNIQUE("start_request_id"),
	CONSTRAINT "daily_attempts_terminal_request_unique" UNIQUE("terminal_request_id"),
	CONSTRAINT "daily_attempts_round_number_check" CHECK ("daily_challenge_round_attempts"."round_number" between 1 and 20),
	CONSTRAINT "daily_attempts_challenge_round_number_check" CHECK ("daily_challenge_round_attempts"."challenge_round_number" between 1 and 20),
	CONSTRAINT "daily_attempts_status_check" CHECK ("daily_challenge_round_attempts"."status" in ('active', 'bombed', 'cashed_out', 'cleared', 'timed_out')),
	CONSTRAINT "daily_attempts_opened_bag_count_check" CHECK ("daily_challenge_round_attempts"."opened_bag_count" between 0 and 8),
	CONSTRAINT "daily_attempts_elapsed_seconds_check" CHECK ("daily_challenge_round_attempts"."elapsed_seconds" is null or "daily_challenge_round_attempts"."elapsed_seconds" between 0 and 60),
	CONSTRAINT "daily_attempts_captured_coins_check" CHECK ("daily_challenge_round_attempts"."captured_coins" is null or "daily_challenge_round_attempts"."captured_coins" between 0 and 3),
	CONSTRAINT "daily_attempts_coin_bag_hits_check" CHECK ("daily_challenge_round_attempts"."coin_bag_hits" is null or "daily_challenge_round_attempts"."coin_bag_hits" between 0 and "daily_challenge_round_attempts"."opened_bag_count"),
	CONSTRAINT "daily_attempts_state_check" CHECK ((
        "daily_challenge_round_attempts"."status" = 'active'
        and "daily_challenge_round_attempts"."ended_at" is null
        and "daily_challenge_round_attempts"."elapsed_seconds" is null
        and "daily_challenge_round_attempts"."captured_coins" is null
        and "daily_challenge_round_attempts"."coin_bag_hits" is null
        and "daily_challenge_round_attempts"."terminal_request_id" is null
      ) or (
        "daily_challenge_round_attempts"."status" = 'bombed'
        and "daily_challenge_round_attempts"."ended_at" is not null
        and "daily_challenge_round_attempts"."elapsed_seconds" between 0 and 59
        and "daily_challenge_round_attempts"."captured_coins" = 0
        and "daily_challenge_round_attempts"."opened_bag_count" between 1 and 8
        and "daily_challenge_round_attempts"."coin_bag_hits" is not null
        and "daily_challenge_round_attempts"."terminal_request_id" is not null
      ) or (
        "daily_challenge_round_attempts"."status" = 'cashed_out'
        and "daily_challenge_round_attempts"."ended_at" is not null
        and "daily_challenge_round_attempts"."elapsed_seconds" between 0 and 59
        and "daily_challenge_round_attempts"."captured_coins" in (1, 2)
        and "daily_challenge_round_attempts"."opened_bag_count" between 1 and 8
        and "daily_challenge_round_attempts"."coin_bag_hits" is not null
        and "daily_challenge_round_attempts"."terminal_request_id" is not null
      ) or (
        "daily_challenge_round_attempts"."status" = 'cleared'
        and "daily_challenge_round_attempts"."ended_at" is not null
        and "daily_challenge_round_attempts"."elapsed_seconds" between 0 and 59
        and "daily_challenge_round_attempts"."captured_coins" = 3
        and "daily_challenge_round_attempts"."opened_bag_count" between 1 and 8
        and "daily_challenge_round_attempts"."coin_bag_hits" is not null
        and "daily_challenge_round_attempts"."terminal_request_id" is not null
      ) or (
        "daily_challenge_round_attempts"."status" = 'timed_out'
        and "daily_challenge_round_attempts"."ended_at" is not null
        and "daily_challenge_round_attempts"."elapsed_seconds" = 60
        and "daily_challenge_round_attempts"."captured_coins" = 0
        and "daily_challenge_round_attempts"."coin_bag_hits" is not null
      )),
	CONSTRAINT "daily_attempts_version_check" CHECK ("daily_challenge_round_attempts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_challenge_round_opens" (
	"participant_id" uuid NOT NULL,
	"challenge_date" date NOT NULL,
	"round_number" smallint NOT NULL,
	"open_order" smallint NOT NULL,
	"bag_number" smallint NOT NULL,
	"request_id" uuid NOT NULL,
	"remaining_seconds_at_tap" smallint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_opens_participant_round_order_pk" PRIMARY KEY("participant_id","round_number","open_order"),
	CONSTRAINT "daily_opens_participant_round_bag_unique" UNIQUE("participant_id","round_number","bag_number"),
	CONSTRAINT "daily_opens_request_unique" UNIQUE("request_id"),
	CONSTRAINT "daily_opens_round_number_check" CHECK ("daily_challenge_round_opens"."round_number" between 1 and 20),
	CONSTRAINT "daily_opens_open_order_check" CHECK ("daily_challenge_round_opens"."open_order" between 1 and 8),
	CONSTRAINT "daily_opens_bag_number_check" CHECK ("daily_challenge_round_opens"."bag_number" between 1 and 8),
	CONSTRAINT "daily_opens_remaining_seconds_check" CHECK ("daily_challenge_round_opens"."remaining_seconds_at_tap" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "daily_challenge_participants" ADD CONSTRAINT "daily_challenge_participants_challenge_date_daily_challenges_challenge_date_fk" FOREIGN KEY ("challenge_date") REFERENCES "public"."daily_challenges"("challenge_date") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_round_attempts" ADD CONSTRAINT "daily_attempts_participant_fk" FOREIGN KEY ("challenge_date","participant_id") REFERENCES "public"."daily_challenge_participants"("challenge_date","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_round_attempts" ADD CONSTRAINT "daily_attempts_placement_fk" FOREIGN KEY ("challenge_date","challenge_round_number") REFERENCES "public"."daily_challenge_placements"("challenge_date","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenge_round_opens" ADD CONSTRAINT "daily_opens_attempt_fk" FOREIGN KEY ("challenge_date","participant_id","round_number") REFERENCES "public"."daily_challenge_round_attempts"("challenge_date","participant_id","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_participants_token_hash_unique" ON "daily_challenge_participants" USING btree ("auth_token_hash");--> statement-breakpoint
CREATE INDEX "daily_participants_ranking_idx" ON "daily_challenge_participants" USING btree ("challenge_date","completed_at","expired_at","accepted_at");--> statement-breakpoint
CREATE INDEX "daily_attempts_date_status_idx" ON "daily_challenge_round_attempts" USING btree ("challenge_date","status");