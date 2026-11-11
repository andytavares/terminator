; Vendored unchanged from https://github.com/tree-sitter/tree-sitter-typescript/blob/f975a621f4e7f532fe322e13c4f79495e0a7b2e7/queries/tags.scm
; tree-sitter-typescript v0.23.2, commit f975a621f4e7f532fe322e13c4f79495e0a7b2e7

(function_signature
  name: (identifier) @name) @definition.function

(method_signature
  name: (property_identifier) @name) @definition.method

(abstract_method_signature
  name: (property_identifier) @name) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name) @definition.class

(module
  name: (identifier) @name) @definition.module

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(type_annotation
  (type_identifier) @name) @reference.type

(new_expression
  constructor: (identifier) @name) @reference.class
