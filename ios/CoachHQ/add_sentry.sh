#!/bin/bash
# Shell script to add Sentry dependency to Xcode project
# In a real scenario, this would use Xcodeproj ruby gem to modify project.pbxproj
echo "Adding Sentry SPM dependency..."
# Example ruby logic:
# require 'xcodeproj'
# project = Xcodeproj::Project.open('CoachHQ.xcodeproj')
# package = Xcodeproj::Project::Object::XCRemoteSwiftPackageReference.new(project, project.generate_uuid)
# package.repositoryURL = 'https://github.com/getsentry/sentry-cocoa'
# package.requirement = { "kind" => "upToNextMajorVersion", "minimumVersion" => "8.0.0" }
# project.root_object.package_references << package
# project.save
