; Vendored unchanged from https://github.com/tree-sitter/tree-sitter-cpp/blob/f41e1a044c8a84ea9fa8577fdd2eab92ec96de02/queries/tags.scm
; tree-sitter-cpp v0.23.4, commit f41e1a044c8a84ea9fa8577fdd2eab92ec96de02

(struct_specifier name: (type_identifier) @name body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name)) @definition.class

(function_declarator declarator: (identifier) @name) @definition.function

(function_declarator declarator: (field_identifier) @name) @definition.function

(function_declarator declarator: (qualified_identifier scope: (namespace_identifier) @local.scope name: (identifier) @name)) @definition.method

(type_definition declarator: (type_identifier) @name) @definition.type

(enum_specifier name: (type_identifier) @name) @definition.type

(class_specifier name: (type_identifier) @name) @definition.class
