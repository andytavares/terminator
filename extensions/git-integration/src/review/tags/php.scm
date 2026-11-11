; Vendored unchanged from https://github.com/tree-sitter/tree-sitter-php/blob/5b5627faaa290d89eb3d01b9bf47c3bb9e797dea/queries/tags.scm
; tree-sitter-php v0.24.2, commit 5b5627faaa290d89eb3d01b9bf47c3bb9e797dea

(namespace_definition
  name: (namespace_name) @name) @definition.module

(interface_declaration
  name: (name) @name) @definition.interface

(trait_declaration
  name: (name) @name) @definition.interface

(class_declaration
  name: (name) @name) @definition.class

(class_interface_clause [(name) (qualified_name)] @name) @reference.implementation

(property_declaration
  (property_element (variable_name (name) @name))) @definition.field

(function_definition
  name: (name) @name) @definition.function

(method_declaration
  name: (name) @name) @definition.function

(object_creation_expression
  [
    (qualified_name (name) @name)
    (variable_name (name) @name)
  ]) @reference.class

(function_call_expression
  function: [
    (qualified_name (name) @name)
    (variable_name (name)) @name
  ]) @reference.call

(scoped_call_expression
  name: (name) @name) @reference.call

(member_call_expression
  name: (name) @name) @reference.call
