import { Schema, Type } from "@google/genai";

export const SCHEMA_PASS_0: Schema = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      enum: ['coding', 'meeting', 'lecture', 'presentation', 'conversation', 'mixed'],
      description: 'Primary video type classification',
    },
    speakers: {
      type: Type.OBJECT,
      properties: {
        count: { type: Type.INTEGER, description: 'Number of distinct speakers' },
        identified: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Names of identified speakers (from introductions or on-screen labels)',
        },
      },
      required: ['count', 'identified'],
    },
    visualContent: {
      type: Type.OBJECT,
      properties: {
        hasCode: { type: Type.BOOLEAN, description: 'Code visible on screen (editor, terminal, IDE)' },
        hasSlides: { type: Type.BOOLEAN, description: 'Presentation slides visible' },
        hasDiagrams: { type: Type.BOOLEAN, description: 'Diagrams, charts, or architectural drawings visible' },
        hasPeopleGrid: { type: Type.BOOLEAN, description: 'Video grid of multiple people (e.g. Zoom, Teams)' },
        hasChatbox: { type: Type.BOOLEAN, description: 'Chat panel visible (e.g. Zoom chat, live stream chat)' },
        hasWhiteboard: { type: Type.BOOLEAN, description: 'Whiteboard or handwritten notes visible' },
        hasTerminal: { type: Type.BOOLEAN, description: 'Terminal or command-line interface visible' },
        hasScreenShare: { type: Type.BOOLEAN, description: 'Screen sharing or desktop recording' },
      },
      required: ['hasCode', 'hasSlides', 'hasDiagrams', 'hasPeopleGrid', 'hasChatbox', 'hasWhiteboard', 'hasTerminal', 'hasScreenShare'],
    },
    audioContent: {
      type: Type.OBJECT,
      properties: {
        hasMultipleSpeakers: { type: Type.BOOLEAN, description: 'More than one speaker detected' },
        primaryLanguage: { type: Type.STRING, description: 'Primary spoken language (e.g. English, Spanish)' },
        quality: {
          type: Type.STRING,
          enum: ['high', 'medium', 'low'],
          description: 'Audio quality assessment',
        },
      },
      required: ['hasMultipleSpeakers', 'primaryLanguage', 'quality'],
    },
    complexity: {
      type: Type.STRING,
      enum: ['simple', 'moderate', 'complex'],
      description: 'Content complexity — affects segment duration and resolution',
    },
    recommendations: {
      type: Type.OBJECT,
      properties: {
        resolution: {
          type: Type.STRING,
          enum: ['low', 'medium', 'high'],
          description: 'Recommended media resolution for extraction passes',
        },
        segmentMinutes: { type: Type.INTEGER, description: 'Recommended segment duration in minutes' },
        passes: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Passes that should run (e.g. transcript, visual)',
        },
      },
      required: ['resolution', 'segmentMinutes', 'passes'],
    },
  },
  required: ['type', 'speakers', 'visualContent', 'audioContent', 'complexity', 'recommendations'],
};

export const SCHEMA_PASS_1: Schema = {
  type: Type.OBJECT,
  properties: {
    segment_index: { type: Type.INTEGER, description: "0-based segment index" },
    time_range: { type: Type.STRING, description: "Format: HH:MM:SS - HH:MM:SS" },
    transcript_entries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: "HH:MM:SS format" },
          speaker: { type: Type.STRING, description: "SPEAKER_00, SPEAKER_01, etc." },
          text: { type: Type.STRING, description: "Complete spoken text, verbatim" },
          tone: {
            type: Type.STRING,
            enum: ["neutral", "emphatic", "questioning", "warning", "excited", "humorous", "frustrated", "instructional", "conversational"]
          },
          emphasis_words: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Words spoken with notable emphasis"
          },
          pause_after_seconds: { type: Type.NUMBER, description: "Pause duration in seconds" }
        },
        required: ["timestamp", "speaker", "text", "tone"]
      }
    },
    speaker_summary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker_id: { type: Type.STRING },
          description: { type: Type.STRING }
        }
      }
    }
  },
  required: ["segment_index", "time_range", "transcript_entries"]
};

export const SCHEMA_PASS_2: Schema = {
  type: Type.OBJECT,
  properties: {
    segment_index: { type: Type.INTEGER, description: "0-based segment index" },
    time_range: { type: Type.STRING, description: "Format: HH:MM:SS - HH:MM:SS" },
    code_blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: "HH:MM:SS start" },
          timestamp_end: { type: Type.STRING, description: "HH:MM:SS end" },
          filename: { type: Type.STRING, description: "Filename or empty string" },
          language: { type: Type.STRING, description: "Programming language" },
          content: { type: Type.STRING, description: "Complete code content" },
          screen_type: {
            type: Type.STRING,
            enum: ["code_editor", "terminal", "browser", "slide", "diagram", "other"]
          },
          change_type: {
            type: Type.STRING,
            enum: ["new_file", "addition", "modification", "deletion", "unchanged", "scroll"]
          },
          lines_changed: { type: Type.STRING },
          instructor_explanation: { type: Type.STRING }
        },
        required: ["timestamp", "language", "content", "screen_type"]
      }
    },
    visual_notes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING },
          visual_type: {
            type: Type.STRING,
            enum: ["slide", "diagram", "browser_output", "ui_demo", "terminal_output", "whiteboard", "other"]
          },
          description: { type: Type.STRING }
        },
        required: ["timestamp", "visual_type", "description"]
      }
    },
    screen_timeline: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING },
          screen_state: { type: Type.STRING }
        }
      }
    }
  },
  required: ["segment_index", "time_range", "code_blocks"]
};

export const SCHEMA_MEETING_NOTES: Schema = {
  type: Type.OBJECT,
  properties: {
    overview: { type: Type.STRING, description: "2-3 sentence summary of the entire video content" },
    key_decisions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING, description: "The decision made" },
          timestamp: { type: Type.STRING, description: "HH:MM:SS when discussed" },
          context: { type: Type.STRING, description: "Why this decision was made, reasoning given" },
        },
        required: ["decision", "timestamp", "context"],
      },
    },
    key_concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          concept: { type: Type.STRING, description: "The concept or technique name" },
          explanation: { type: Type.STRING, description: "The instructor's explanation, with specifics" },
          timestamp: { type: Type.STRING, description: "HH:MM:SS when first introduced" },
        },
        required: ["concept", "explanation", "timestamp"],
      },
    },
    action_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: { type: Type.STRING, description: "Task, exercise, or thing to try" },
          timestamp: { type: Type.STRING, description: "HH:MM:SS when mentioned" },
          mentioned_by: { type: Type.STRING, description: "Who mentioned it (speaker ID or name)" },
        },
        required: ["item", "timestamp", "mentioned_by"],
      },
    },
    questions_raised: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING, description: "The question asked" },
          timestamp: { type: Type.STRING, description: "HH:MM:SS when asked" },
          answered: { type: Type.BOOLEAN, description: "Whether the question was answered in the video" },
        },
        required: ["question", "timestamp", "answered"],
      },
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "AI-generated suggestions for further learning or practice",
    },
    topics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Topic title" },
          timestamps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "All timestamps where this topic is discussed",
          },
          summary: { type: Type.STRING, description: "Detailed summary of this topic" },
          key_points: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Specific key points with concrete details",
          },
        },
        required: ["title", "timestamps", "summary", "key_points"],
      },
    },
  },
  required: ["overview", "key_decisions", "key_concepts", "action_items", "questions_raised", "suggestions", "topics"],
};

export const SCHEMA_PASS_3A: Schema = {
  type: Type.OBJECT,
  properties: {
    files: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          filename: { type: Type.STRING, description: 'File name as shown on screen or inferred from context' },
          language: { type: Type.STRING, description: 'Programming language of the file' },
          final_content: { type: Type.STRING, description: 'Complete final state of the file contents' },
          changes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: { type: Type.STRING, description: 'HH:MM:SS when this change occurred' },
                change_type: {
                  type: Type.STRING,
                  enum: ['create', 'addition', 'modification', 'deletion', 'rename'],
                  description: 'Type of change applied to the file',
                },
                description: { type: Type.STRING, description: 'Human-readable description of what changed' },
                diff_summary: { type: Type.STRING, description: 'Brief summary of the lines/logic added or removed' },
              },
              required: ['timestamp', 'change_type', 'description', 'diff_summary'],
            },
          },
        },
        required: ['filename', 'language', 'final_content', 'changes'],
      },
      description: 'All code files reconstructed across the entire video',
    },
    dependencies_mentioned: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Libraries, packages, or modules referenced (e.g. "express", "lodash@4.17")',
    },
    build_commands: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Build, run, or install commands mentioned or shown (e.g. "npm install", "go build .")',
    },
  },
  required: ['files', 'dependencies_mentioned', 'build_commands'],
};

export const SCHEMA_PASS_3B: Schema = {
  type: Type.OBJECT,
  properties: {
    participants: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Full name of the participant' },
          role: { type: Type.STRING, description: 'Job title or role (e.g. "Software Engineer", "Host", "Panelist")' },
          organization: { type: Type.STRING, description: 'Company or organization they represent, or empty string' },
          speaking_segments: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'HH:MM:SS timestamps of segments where they speak',
          },
          contact_info: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Email addresses, Twitter handles, LinkedIn URLs, or other contact details mentioned',
          },
          contributions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Key points made or topics introduced by this person',
          },
        },
        required: ['name', 'role', 'organization', 'speaking_segments', 'contact_info', 'contributions'],
      },
    },
    relationships: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Relationships between participants (e.g. "Alice reports to Bob", "Carol and Dave are co-founders")',
    },
  },
  required: ['participants', 'relationships'],
};

export const SCHEMA_PASS_3C: Schema = {
  type: Type.OBJECT,
  properties: {
    messages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: 'HH:MM:SS when the message appears on screen' },
          sender: { type: Type.STRING, description: 'Display name or username of the message sender' },
          text: { type: Type.STRING, description: 'Full verbatim text of the chat message' },
        },
        required: ['timestamp', 'sender', 'text'],
      },
      description: 'All chat messages visible in the chat panel throughout the video',
    },
    links: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING, description: 'The full URL as shown or spoken' },
          context: { type: Type.STRING, description: 'What the link refers to or why it was shared' },
          timestamp: { type: Type.STRING, description: 'HH:MM:SS when the link appeared or was mentioned' },
        },
        required: ['url', 'context', 'timestamp'],
      },
      description: 'All URLs and links extracted from chat messages or spoken aloud',
    },
  },
  required: ['messages', 'links'],
};

export const SCHEMA_PASS_3D: Schema = {
  type: Type.OBJECT,
  properties: {
    emotional_shifts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: 'HH:MM:SS when the shift occurs' },
          from_state: { type: Type.STRING, description: 'Emotional or energy state before the shift' },
          to_state: { type: Type.STRING, description: 'Emotional or energy state after the shift' },
          trigger: { type: Type.STRING, description: 'What caused the shift (topic change, question, announcement)' },
        },
        required: ['timestamp', 'from_state', 'to_state', 'trigger'],
      },
    },
    questions_implicit: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Questions implied by the conversation but never explicitly asked',
    },
    decisions_implicit: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Decisions made through consensus or assumption without being explicitly stated',
    },
    tasks_assigned: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: 'HH:MM:SS when the task was assigned' },
          assignee: { type: Type.STRING, description: 'Person or team the task was directed at' },
          task: { type: Type.STRING, description: 'Description of the task or responsibility' },
          deadline: { type: Type.STRING, description: 'Deadline mentioned, or empty string if none' },
        },
        required: ['timestamp', 'assignee', 'task', 'deadline'],
      },
    },
    emphasis_patterns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          concept: { type: Type.STRING, description: 'The concept, term, or idea that was repeated' },
          times_mentioned: { type: Type.INTEGER, description: 'Number of times it was mentioned' },
          timestamps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'HH:MM:SS of each mention',
          },
          significance: { type: Type.STRING, description: 'Why repeated mention signals this is important' },
        },
        required: ['concept', 'times_mentioned', 'timestamps', 'significance'],
      },
    },
  },
  required: ['emotional_shifts', 'questions_implicit', 'decisions_implicit', 'tasks_assigned', 'emphasis_patterns'],
};

export const SCHEMA_SYNTHESIS: Schema = {
  type: Type.OBJECT,
  properties: {
    overview: { type: Type.STRING, description: '2-4 sentence summary of the entire video' },
    key_decisions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING },
          timestamp: { type: Type.STRING },
          context: { type: Type.STRING },
        },
        required: ['decision', 'timestamp', 'context'],
      },
    },
    key_concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          concept: { type: Type.STRING },
          explanation: { type: Type.STRING },
          timestamp: { type: Type.STRING },
        },
        required: ['concept', 'explanation', 'timestamp'],
      },
    },
    action_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: { type: Type.STRING },
          timestamp: { type: Type.STRING },
          mentioned_by: { type: Type.STRING },
        },
        required: ['item', 'timestamp', 'mentioned_by'],
      },
    },
    questions_raised: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          timestamp: { type: Type.STRING },
          answered: { type: Type.BOOLEAN },
        },
        required: ['question', 'timestamp', 'answered'],
      },
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'AI-generated suggestions for follow-up, further learning, or next steps',
    },
    topics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          timestamps: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'timestamps', 'summary', 'key_points'],
      },
    },
    files_to_generate: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Names of output files that should be generated from this video (e.g. "transcript.md", "code/main.py")',
    },
  },
  required: ['overview', 'key_decisions', 'key_concepts', 'action_items', 'questions_raised', 'suggestions', 'topics', 'files_to_generate'],
};
