//! Static agent guidance served over MCP: one short operational prompt and
//! three read-only resources.
//!
//! The text lives in `docs/mcp/` and `docs/` and is compiled in with
//! `include_str!`, so the binary and the repository never disagree about what
//! an agent is told. Nothing here touches the renderer or the document: the
//! guidance is transport-level static content, available even while the
//! renderer bridge is not ready, which is why it is answered natively rather
//! than routed through the semantic service like tools are.
//!
//! Sizes: the prompt is a few KB; the resources are ~15–60 KB each, which is
//! why they are resources (fetched on demand) and not part of the prompt or
//! the server instructions.
use rmcp::model::{
    GetPromptResult, Prompt, PromptMessage, PromptMessageContent, PromptMessageRole, RawResource,
    ReadResourceResult, Resource, ResourceContents,
};

/// Name of the single prompt the server offers.
pub const PROMPT_NAME: &str = "origami-workflow";

const PROMPT_TEXT: &str = include_str!("../../../../../docs/mcp/agent-prompt.md");

/// A guidance document exposed as an MCP resource.
pub struct GuideResource {
    pub uri: &'static str,
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub text: &'static str,
}

/// Every resource the server serves, in listing order. The diagnostics table
/// is first because the prompt tells agents to read it before their first
/// `checks` result.
pub const RESOURCES: &[GuideResource] = &[
    GuideResource {
        uri: "ori-studio://guide/diagnostics",
        name: "diagnostics",
        title: "Diagnostic decision tables",
        description: "Check1 / Check2 / Check3 / CheckCamv / Spatial* entries, flat_fold and \
                      simulation outcomes, TreeMaker cp_status and Box Pleating packing results: \
                      meaning, default action, and what not to do.",
        text: include_str!("../../../../../docs/mcp/diagnostics.md"),
    },
    GuideResource {
        uri: "ori-studio://guide/recipes",
        name: "recipes",
        title: "Operational recipes",
        description: "Step-by-step tool sequences: inspect and repair a crease pattern, \
                      interpret checks, classical flat-foldability repair, TreeMaker and Box \
                      Pleating design to crease pattern, reading flat_fold and simulation, and \
                      editing the user's active document safely.",
        text: include_str!("../../../../../docs/mcp/recipes.md"),
    },
    GuideResource {
        uri: "ori-studio://guide/knowledge",
        name: "knowledge",
        title: "Origami design knowledge base",
        description: "Source-backed reference behind the recipes and diagnostics: theory, \
                      upstream behaviour, Ori Studio implementation facts, known gaps and open \
                      questions, with citations.",
        text: include_str!("../../../../../docs/origami-design-knowledge.md"),
    },
];

const MARKDOWN: &str = "text/markdown";

pub fn prompt_list() -> Vec<Prompt> {
    vec![Prompt::new(
        PROMPT_NAME,
        Some(
            "Operating rules for designing, checking, repairing and exporting origami through \
             Ori Studio, plus pointers to the detailed guide resources.",
        ),
        None,
    )]
}

pub fn prompt(name: &str) -> Option<GetPromptResult> {
    (name == PROMPT_NAME).then(|| {
        let mut result = GetPromptResult::new(vec![PromptMessage::new(
            PromptMessageRole::User,
            PromptMessageContent::text(PROMPT_TEXT),
        )]);
        result.description = Some("Ori Studio origami workflow".into());
        result
    })
}

pub fn resource_list() -> Vec<Resource> {
    RESOURCES
        .iter()
        .map(|guide| {
            let mut raw = RawResource::new(guide.uri, guide.name);
            raw.title = Some(guide.title.into());
            raw.description = Some(guide.description.into());
            raw.mime_type = Some(MARKDOWN.into());
            raw.size = u32::try_from(guide.text.len()).ok();
            Resource::new(raw, None)
        })
        .collect()
}

pub fn read_resource(uri: &str) -> Option<ReadResourceResult> {
    RESOURCES
        .iter()
        .find(|guide| guide.uri == uri)
        .map(|guide| {
            ReadResourceResult::new(vec![ResourceContents::TextResourceContents {
                uri: guide.uri.into(),
                mime_type: Some(MARKDOWN.into()),
                text: guide.text.into(),
                meta: None,
            }])
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_is_short_and_points_at_every_resource() {
        let result = prompt(PROMPT_NAME).expect("prompt exists");
        let text = match &result.messages[0].content {
            PromptMessageContent::Text { text } => text.clone(),
            other => panic!("unexpected prompt content {other:?}"),
        };
        assert!(
            text.len() < 8 * 1024,
            "the prompt is meant to be operational, not the reference: {} bytes",
            text.len()
        );
        for guide in RESOURCES {
            assert!(
                text.contains(guide.uri),
                "prompt does not mention {}",
                guide.uri
            );
        }
        assert!(prompt("something-else").is_none());
    }

    #[test]
    fn every_listed_resource_is_readable_as_markdown() {
        let listed = resource_list();
        assert_eq!(listed.len(), RESOURCES.len());
        for resource in &listed {
            let read = read_resource(&resource.raw.uri).expect("listed resource reads");
            match &read.contents[0] {
                ResourceContents::TextResourceContents {
                    uri,
                    mime_type,
                    text,
                    ..
                } => {
                    assert_eq!(uri, &resource.raw.uri);
                    assert_eq!(mime_type.as_deref(), Some(MARKDOWN));
                    assert!(text.starts_with("# "), "{} is not a markdown document", uri);
                    assert_eq!(resource.raw.size, u32::try_from(text.len()).ok());
                }
                other => panic!("unexpected resource content {other:?}"),
            }
        }
        assert!(read_resource("ori-studio://guide/missing").is_none());
    }

    #[test]
    fn guides_cite_the_knowledge_base_and_each_other() {
        let diagnostics = read_text("ori-studio://guide/diagnostics");
        let recipes = read_text("ori-studio://guide/recipes");
        assert!(diagnostics.contains("origami-design-knowledge.md"));
        assert!(recipes.contains("diagnostics.md"));
        // The narrow TreeMaker rule must be stated with its scope in both.
        for text in [&diagnostics, &recipes] {
            assert!(text.contains("has_full_cp"));
            assert!(text.contains("unedited"));
        }
    }

    fn read_text(uri: &str) -> String {
        match read_resource(uri).expect("resource").contents.remove(0) {
            ResourceContents::TextResourceContents { text, .. } => text,
            other => panic!("unexpected resource content {other:?}"),
        }
    }
}
