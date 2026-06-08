# Database Design

## Alliance

id
name
server_number
description
created_at
updated_at

## User

id
email
display_name
discord_name
created_at
updated_at

## AllianceMembership

id
alliance_id
user_id
role

-- OWNER
-- ADMIN
-- LEADER
-- VIEWER

created_at

## Member

id
alliance_id

player_name

discord_name

current_role

thp
main_squad_power

resistance_level

availability_10am
availability_6pm
availability_10pm

join_date

active

created_at
updated_at

## Metric

id
alliance_id

name

description

weight

metric_type

-- NUMERIC
-- BOOLEAN
-- LEADERSHIP

active

created_at

examples:
VS Score
Meteor
Battle Participation
Communication
Leadership Potential
Following Orders

## MemberMetricEntry

id

member_id
metric_id

score

recorded_date

recorded_by

notes

created_at

Member: Dragon

Metric:
Meteor

Score:
92

Date:
2026-06-01

## LeadershipNote

id

member_id

author_id

note_type

-- POSITIVE
-- WARNING
-- OBSERVATION
-- PROMOTION
-- DEMOTION

content

created_at

## Reliability Categories

### MemberAssessment

id

member_id

assessor_id

category

score

comments

assessment_date

example categories:

Communication
Reliability
Leadership
Teamwork
Initiative

## FUTURE TABLES (NOT MVP)

### Recruit

id
alliance_id

player_name

status

notes

### AllianceRelationship

id

alliance_id

target_alliance

relationship_type

notes

### Meeting

id
alliance_id

title

notes

meeting_date
