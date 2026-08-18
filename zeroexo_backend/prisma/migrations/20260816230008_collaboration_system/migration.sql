-- CreateTable
CREATE TABLE "CollaborationRoom" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "inviteLink" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'invite-only',
    "maxMembers" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowChat" BOOLEAN NOT NULL DEFAULT true,
    "allowAgentChat" BOOLEAN NOT NULL DEFAULT true,
    "allowEdit" BOOLEAN NOT NULL DEFAULT true,
    "allowDownload" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CollaborationRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaborationMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "permissions" TEXT NOT NULL DEFAULT 'view,chat',
    "status" TEXT NOT NULL DEFAULT 'online',
    "deviceType" TEXT NOT NULL DEFAULT 'desktop',
    "sessionIndex" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollaborationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaborationMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agentMentioned" BOOLEAN NOT NULL DEFAULT false,
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollaborationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL DEFAULT 'canvas-assistant',
    "systemPrompt" TEXT,
    "memory" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSessionMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSessionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationRoom_inviteCode_key" ON "CollaborationRoom"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationRoom_inviteLink_key" ON "CollaborationRoom"("inviteLink");

-- CreateIndex
CREATE INDEX "CollaborationRoom_canvasId_idx" ON "CollaborationRoom"("canvasId");

-- CreateIndex
CREATE INDEX "CollaborationRoom_inviteCode_idx" ON "CollaborationRoom"("inviteCode");

-- CreateIndex
CREATE INDEX "CollaborationRoom_status_idx" ON "CollaborationRoom"("status");

-- CreateIndex
CREATE INDEX "CollaborationMember_roomId_idx" ON "CollaborationMember"("roomId");

-- CreateIndex
CREATE INDEX "CollaborationMember_userId_idx" ON "CollaborationMember"("userId");

-- CreateIndex
CREATE INDEX "CollaborationMember_status_idx" ON "CollaborationMember"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationMember_roomId_userId_sessionIndex_key" ON "CollaborationMember"("roomId", "userId", "sessionIndex");

-- CreateIndex
CREATE INDEX "CollaborationMessage_roomId_idx" ON "CollaborationMessage"("roomId");

-- CreateIndex
CREATE INDEX "CollaborationMessage_senderId_idx" ON "CollaborationMessage"("senderId");

-- CreateIndex
CREATE INDEX "CollaborationMessage_createdAt_idx" ON "CollaborationMessage"("createdAt");

-- CreateIndex
CREATE INDEX "AgentSession_canvasId_idx" ON "AgentSession"("canvasId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_roomId_key" ON "AgentSession"("roomId");

-- CreateIndex
CREATE INDEX "AgentSessionMessage_sessionId_idx" ON "AgentSessionMessage"("sessionId");

-- CreateIndex
CREATE INDEX "AgentSessionMessage_createdAt_idx" ON "AgentSessionMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "CollaborationMember" ADD CONSTRAINT "CollaborationMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CollaborationRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationMember" ADD CONSTRAINT "CollaborationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaborationMessage" ADD CONSTRAINT "CollaborationMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CollaborationRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CollaborationRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSessionMessage" ADD CONSTRAINT "AgentSessionMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
