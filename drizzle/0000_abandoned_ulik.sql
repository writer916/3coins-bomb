CREATE TABLE "duel_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_rounds" smallint NOT NULL,
	"create_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "duel_matches_create_request_id_unique" UNIQUE("create_request_id"),
	CONSTRAINT "duel_matches_total_rounds_check" CHECK ("duel_matches"."total_rounds" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "duel_participants" (
	"match_id" uuid NOT NULL,
	"role" text NOT NULL,
	"auth_token_hash" varchar(64),
	"invite_token_hash" varchar(64),
	"claimed_at" timestamp with time zone,
	"placement_locked_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "duel_participants_match_id_role_pk" PRIMARY KEY("match_id","role"),
	CONSTRAINT "duel_participants_role_check" CHECK ("duel_participants"."role" in ('A', 'B')),
	CONSTRAINT "duel_participants_auth_token_hash_check" CHECK ("duel_participants"."auth_token_hash" is null or "duel_participants"."auth_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "duel_participants_invite_token_hash_check" CHECK ("duel_participants"."invite_token_hash" is null or "duel_participants"."invite_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "duel_participants_claim_state_check" CHECK ((
        "duel_participants"."role" = 'A'
        and "duel_participants"."auth_token_hash" is not null
        and "duel_participants"."invite_token_hash" is null
        and "duel_participants"."claimed_at" is not null
      ) or (
        "duel_participants"."role" = 'B'
        and (
          (
            "duel_participants"."auth_token_hash" is null
            and "duel_participants"."invite_token_hash" is not null
            and "duel_participants"."claimed_at" is null
          ) or (
            "duel_participants"."auth_token_hash" is not null
            and "duel_participants"."invite_token_hash" is null
            and "duel_participants"."claimed_at" is not null
          )
        )
      )),
	CONSTRAINT "duel_participants_version_check" CHECK ("duel_participants"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "duel_participants" ADD CONSTRAINT "duel_participants_match_id_duel_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."duel_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duel_participants_auth_token_hash_unique" ON "duel_participants" USING btree ("auth_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "duel_participants_invite_token_hash_unique" ON "duel_participants" USING btree ("invite_token_hash");